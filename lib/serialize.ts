export function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export interface BookmarkRow {
  id: string;
  user_id: string;
  collection_id: string | null;
  collection_name?: string | null;
  source_type: "url" | "text";
  url: string | null;
  normalized_url: string | null;
  domain: string | null;
  title: string;
  note: string | null;
  content_text: string | null;
  content_hash: string | null;
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  attempts: number;
  processing_started_at: unknown;
  captured_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

export function bookmarkJson(
  row: BookmarkRow,
  tags: string[],
  semanticIndexed: boolean,
): Record<string, unknown> {
  return {
    id: row.id,
    sourceType: row.source_type,
    url: row.url,
    domain: row.domain,
    title: row.title,
    note: row.note,
    collection: row.collection_id
      ? { id: row.collection_id, name: row.collection_name ?? null }
      : null,
    tags,
    status: row.status,
    error: row.error,
    attempts: row.attempts,
    semanticIndexed,
    excerpt: row.content_text ? row.content_text.slice(0, 240) : null,
    capturedAt: toIso(row.captured_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}
