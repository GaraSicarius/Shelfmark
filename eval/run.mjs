// Evaluation harness: seeds eval/fixtures.json into a fresh account on a running server,
// runs the Find and Ask sets, and writes raw observations (no invented scores).
// Usage: BASE_URL=http://localhost:3000 node eval/run.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const fixtures = JSON.parse(await readFile(new URL("./fixtures.json", import.meta.url), "utf8"));
let cookie = "";

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", origin: BASE, cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get("set-cookie");
  if (set?.startsWith("session=")) cookie = set.split(";")[0];
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const email = `eval-${Date.now()}@example.test`;
const signup = await api("POST", "/api/auth/signup", { email, password: "evaluation-pass-1" });
if (signup.status !== 201) throw new Error(`signup failed: ${signup.status} ${JSON.stringify(signup.json)}`);

const collections = {};
for (const name of new Set(fixtures.documents.map((d) => d.collection).filter(Boolean))) {
  collections[name] = (await api("POST", "/api/collections", { name })).json.collection.id;
}

const keyById = {};
for (const d of fixtures.documents) {
  const r = await api("POST", "/api/bookmarks", {
    text: d.text, title: d.title, tags: d.tags,
    ...(d.collection ? { collectionId: collections[d.collection] } : {}),
  });
  if (r.status !== 201) throw new Error(`save ${d.key} failed: ${r.status} ${JSON.stringify(r.json)}`);
  keyById[r.json.bookmark.id] = d.key;
}

const deadline = Date.now() + 180_000;
let bookmarks = [];
while (Date.now() < deadline) {
  bookmarks = (await api("GET", "/api/bookmarks")).json.bookmarks;
  if (bookmarks.every((b) => b.status === "ready" || b.status === "failed")) break;
  await new Promise((r) => setTimeout(r, 1500));
}
const indexing = bookmarks.map((b) => ({ key: keyById[b.id], status: b.status, semanticIndexed: b.semanticIndexed, error: b.error }));

const find = [];
for (const f of fixtures.find) {
  const r = await api("GET", `/api/search?q=${encodeURIComponent(f.query)}`);
  const ranked = (r.json?.results ?? []).map((x) => ({ key: keyById[x.bookmark.id], matched: x.matched, score: x.score }));
  const ranks = Object.fromEntries(f.expect.map((k) => [k, ranked.findIndex((x) => x.key === k) + 1 || null]));
  find.push({ ...f, httpStatus: r.status, semantic: r.json?.semantic, ranked: ranked.slice(0, 5), expectedRanks: ranks,
    allExpectedInTop3: f.expect.every((k) => ranks[k] && ranks[k] <= 3) });
}

const ask = [];
for (const q of fixtures.ask) {
  const started = Date.now();
  const r = await api("POST", "/api/ask", { question: q.question });
  const a = r.json?.answer;
  // On 503 ai_unavailable, details.citations still lists the passages retrieval selected.
  const retrieved = [...new Set((a?.citations ?? r.json?.details?.citations ?? []).map((c) => keyById[c.bookmarkId]))];
  const cited = a
    ? [...new Set([...a.segments.flatMap((s) => s.citations), ...a.conflicts.flatMap((c) => c.citations)]
        .map((n) => keyById[a.citations.find((c) => c.n === n)?.bookmarkId]).filter(Boolean))]
    : [];
  const allText = a ? [...a.segments.map((s) => s.text), ...a.conflicts.map((c) => c.description), ...a.gaps].join("\n") : "";
  ask.push({
    ...q, httpStatus: r.status, ms: Date.now() - started, error: r.json?.error,
    status: a?.status, retrievedSources: retrieved, citedSources: cited,
    expectedRetrieved: Object.fromEntries(q.expect.map((k) => [k, retrieved.includes(k)])),
    expectedCited: Object.fromEntries(q.expect.map((k) => [k, cited.includes(k)])),
    segmentKinds: a?.segments.map((s) => s.kind + (s.uncited ? "(uncited)" : "")),
    conflicts: a?.conflicts.length, gaps: a?.gaps, followUps: a?.followUps,
    mentionsInsufficient: /insufficient data to verify/i.test(allText),
    mentionsFree: /\b(free|0 dollars|\$0|costs? nothing)\b/i.test(allText),
    answerText: allText,
  });
}

const out = { base: BASE, ranAt: new Date().toISOString(), account: email, indexing, find, ask };
await mkdir(".data/evidence", { recursive: true });
await writeFile(".data/evidence/eval-results.json", JSON.stringify(out, null, 2));

console.table(indexing);
console.table(find.map((f) => ({ query: f.query, kind: f.kind, semantic: f.semantic, top3: f.ranked.slice(0, 3).map((x) => x.key).join(", "), allExpectedInTop3: f.allExpectedInTop3 })));
console.table(ask.map((a) => ({ kind: a.kind, http: a.httpStatus, status: a.status, retrieved: a.retrievedSources.join(", "), cited: a.citedSources.join(", "), conflicts: a.conflicts, insufficient: a.mentionsInsufficient, ms: a.ms })));
console.log("Full results: .data/evidence/eval-results.json");
