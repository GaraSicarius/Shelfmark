import { embedTexts } from "@/lib/ai";
import { query } from "@/lib/db";

export const MIN_SIMILARITY = 0.30;
const RRF_K = 60;
const BRANCH_LIMIT = 40;

export interface RetrievalFilters {
  collectionId?: string | null;
  tag?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface RankedPassage {
  id: string;
  bookmarkId: string;
  userId: string;
  ordinal: number;
  text: string;
  charStart: number;
  charEnd: number;
  title: string;
  url: string | null;
  domain: string | null;
  capturedAt: unknown;
  createdAt: unknown;
  score: number;
  matched: "keyword" | "semantic" | "both";
}

interface PassageRow {
  id: string;
  bookmark_id: string;
  user_id: string;
  ordinal: number;
  text: string;
  char_start: number;
  char_end: number;
  title: string;
  url: string | null;
  domain: string | null;
  captured_at: unknown;
  created_at: unknown;
}

const PASSAGE_COLUMNS = `p.id, p.bookmark_id, p.user_id, p.ordinal, p.text,
  p.char_start, p.char_end, b.title, b.url, b.domain, b.captured_at, b.created_at`;

// Scope filters live in SQL so both branches see exactly the same universe.
function filterClause(filters: RetrievalFilters, params: unknown[]): string {
  let i = params.length + 1;
  params.push(filters.collectionId ?? null);
  let sql = ` AND ($${i}::uuid IS NULL OR b.collection_id = $${i}::uuid)`;
  i++;
  params.push(filters.tag ?? null);
  sql += ` AND ($${i}::text IS NULL OR EXISTS (
      SELECT 1 FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
      WHERE bt.bookmark_id = b.id AND lower(t.name) = lower($${i})
    ))`;
  i++;
  params.push(filters.from ?? null);
  sql += ` AND ($${i}::date IS NULL OR b.created_at >= $${i}::date)`;
  i++;
  params.push(filters.to ?? null);
  sql += ` AND ($${i}::date IS NULL OR b.created_at < ($${i}::date + 1))`;
  return sql;
}

function tsQueryFor(text: string): string | null {
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12);
  if (words.length === 0) return null;
  return words.map((w) => `${w}:*`).join(" | ");
}

async function keywordBranch(
  userId: string,
  tsq: string,
  filters: RetrievalFilters,
): Promise<PassageRow[]> {
  const params: unknown[] = [tsq, userId];
  const sql = `SELECT ${PASSAGE_COLUMNS}, ts_rank_cd(p.tsv, q.tsq) AS krank
    FROM passages p
    JOIN bookmarks b ON b.id = p.bookmark_id,
    to_tsquery('english', $1) AS q(tsq)
    WHERE p.user_id = $2 AND p.tsv @@ q.tsq
    ${filterClause(filters, params)}
    ORDER BY krank DESC, p.created_at DESC
    LIMIT ${BRANCH_LIMIT}`;
  return query<PassageRow>(sql, params);
}

async function semanticBranch(
  userId: string,
  embedding: number[],
  filters: RetrievalFilters,
): Promise<PassageRow[]> {
  const params: unknown[] = [`[${embedding.join(",")}]`, userId, MIN_SIMILARITY];
  const sql = `SELECT ${PASSAGE_COLUMNS}
    FROM passages p
    JOIN bookmarks b ON b.id = p.bookmark_id
    WHERE p.user_id = $2 AND p.embedding IS NOT NULL
      AND 1 - (p.embedding <=> $1::vector) >= $3
    ${filterClause(filters, params)}
    ORDER BY p.embedding <=> $1::vector
    LIMIT ${BRANCH_LIMIT}`;
  return query<PassageRow>(sql, params);
}

function fuse(
  keywordRows: PassageRow[],
  semanticRows: PassageRow[],
): RankedPassage[] {
  const byId = new Map<
    string,
    { row: PassageRow; keywordRank?: number; semanticRank?: number }
  >();
  keywordRows.forEach((row, idx) => {
    byId.set(row.id, { row, keywordRank: idx + 1 });
  });
  semanticRows.forEach((row, idx) => {
    const existing = byId.get(row.id);
    if (existing) existing.semanticRank = idx + 1;
    else byId.set(row.id, { row, semanticRank: idx + 1 });
  });
  const out: RankedPassage[] = [];
  for (const { row, keywordRank, semanticRank } of byId.values()) {
    const score =
      (keywordRank ? 1 / (RRF_K + keywordRank) : 0) +
      (semanticRank ? 1 / (RRF_K + semanticRank) : 0);
    out.push({
      id: row.id,
      bookmarkId: row.bookmark_id,
      userId: row.user_id,
      ordinal: row.ordinal,
      text: row.text,
      charStart: row.char_start,
      charEnd: row.char_end,
      title: row.title,
      url: row.url,
      domain: row.domain,
      capturedAt: row.captured_at,
      createdAt: row.created_at,
      score,
      matched: keywordRank && semanticRank ? "both" : keywordRank ? "keyword" : "semantic",
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export interface RetrievalResult {
  passages: RankedPassage[];
  semantic: boolean;
}

export async function retrievePassages(
  userId: string,
  text: string,
  filters: RetrievalFilters = {},
): Promise<RetrievalResult> {
  const tsq = tsQueryFor(text);
  const keywordRows = tsq ? await keywordBranch(userId, tsq, filters) : [];

  let semanticRows: PassageRow[] = [];
  let semantic = false;
  try {
    const embedded = await embedTexts([text], "RETRIEVAL_QUERY");
    if (embedded && embedded[0]) {
      semanticRows = await semanticBranch(userId, embedded[0], filters);
      semantic = true;
    }
  } catch (err) {
    // Embedding/vector failures degrade to keyword-only rather than breaking search.
    console.error("[shelfmark] semantic branch unavailable:", err);
  }

  return { passages: fuse(keywordRows, semanticRows), semantic };
}

// Ask context: top 8 passages, at most 3 per bookmark.
export async function passagesForAsk(
  userId: string,
  text: string,
  filters: RetrievalFilters = {},
): Promise<RetrievalResult> {
  const { passages, semantic } = await retrievePassages(userId, text, filters);
  const perBookmark = new Map<string, number>();
  const picked: RankedPassage[] = [];
  for (const p of passages) {
    const count = perBookmark.get(p.bookmarkId) ?? 0;
    if (count >= 3) continue;
    perBookmark.set(p.bookmarkId, count + 1);
    picked.push(p);
    if (picked.length >= 8) break;
  }
  return { passages: picked, semantic };
}

export interface SearchResult {
  bookmarkId: string;
  score: number;
  excerpt: string;
  passageId: string;
  matched: "keyword" | "semantic" | "both";
}

// Find grouping: one row per bookmark, best passage as the excerpt.
export function groupForFind(passages: RankedPassage[]): SearchResult[] {
  const best = new Map<string, RankedPassage>();
  for (const p of passages) {
    const existing = best.get(p.bookmarkId);
    if (!existing || p.score > existing.score) best.set(p.bookmarkId, p);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .map((p) => ({
      bookmarkId: p.bookmarkId,
      score: p.score,
      excerpt: p.text,
      passageId: p.id,
      matched: p.matched,
    }));
}
