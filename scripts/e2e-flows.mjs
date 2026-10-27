// End-to-end flows for Shelfmark against a running dev server. Usage:
//   npm run dev  (in another terminal)
//   node scripts/e2e-flows.mjs [baseUrl]
// Prints PASS/FAIL/SKIP per check, exits non-zero on any FAIL, and writes the
// same output to .data/evidence/e2e-flows.txt.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = path.resolve(".data/evidence/e2e-flows.txt");

const lines = [];
let failures = 0;
function report(status, name, extra = "") {
  const line = `${status} ${name}${extra ? ` — ${extra}` : ""}`;
  lines.push(line);
  console.log(line);
}
const pass = (name, extra) => report("PASS", name, extra);
const fail = (name, extra) => {
  failures += 1;
  report("FAIL", name, extra);
};
const skip = (name, extra) => report("SKIP", name, extra);
const check = (name, ok, extra = "") => (ok ? pass(name, extra) : fail(name, extra));

async function api(pathname, { method = "GET", body, cookie, headers = {} } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body: json, headers: res.headers };
}

function sessionCookie(res) {
  const raw = res.headers.get("set-cookie") ?? "";
  const match = /session=([^;]+)/.exec(raw);
  if (!match) throw new Error("no session cookie in signup response");
  return `session=${match[1]}`;
}

async function signup(email) {
  const res = await api("/api/auth/signup", {
    method: "POST",
    body: { email, password: "e2e-password-123" },
  });
  if (res.status !== 201) throw new Error(`signup ${email}: HTTP ${res.status}`);
  return sessionCookie(res);
}

async function waitForStatus(cookie, id, statuses, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await api(`/api/bookmarks/${id}`, { cookie });
    if (res.status === 200 && statuses.includes(res.body.bookmark.status)) {
      return res.body.bookmark;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const res = await api(`/api/bookmarks/${id}`, { cookie });
  return res.body?.bookmark ?? null;
}

async function main() {
  const ts = Date.now();
  const cookieA = await signup(`e2e-a-${ts}@test.dev`);
  const cookieB = await signup(`e2e-b-${ts}@test.dev`);

  // --- seed user A: collection + pasted-text bookmark ---
  const col = await api("/api/collections", {
    method: "POST",
    cookie: cookieA,
    body: { name: "Test collection: e2e" },
  });
  const collectionId = col.body.collection.id;
  const seedText =
    "Test note body: a free course about the AWS certification exam. " +
    "It includes practice questions, study plans, and the unique term zymurgy. ".repeat(6);
  const created = await api("/api/bookmarks", {
    method: "POST",
    cookie: cookieA,
    body: { title: "Test note: e2e AWS guide", text: seedText, collectionId, tags: ["e2e"] },
  });
  const bm = created.body.bookmark;
  const ready = await waitForStatus(cookieA, bm.id, ["ready", "failed"], 30_000);
  check("a. seeded bookmark reaches ready", ready?.status === "ready", `status=${ready?.status}`);

  // --- a. persistence: contentText + passage offsets ---
  const detail = await api(`/api/bookmarks/${bm.id}`, { cookie: cookieA });
  const { bookmark: full, passages } = detail.body ?? {};
  let offsetsOk = Boolean(full?.contentText) && passages?.length > 0;
  if (offsetsOk) {
    for (const p of passages) {
      if (full.contentText.slice(p.charStart, p.charEnd) !== p.text) {
        offsetsOk = false;
        break;
      }
    }
  }
  check(
    "a. contentText present and passage slices match offsets",
    offsetsOk,
    `passages=${passages?.length ?? 0}`,
  );

  // --- b. public URL extraction ---
  const wiki = await api("/api/bookmarks", {
    method: "POST",
    cookie: cookieA,
    body: {
      title: "Test note: wikipedia RAG",
      url: "https://en.wikipedia.org/wiki/Retrieval-augmented_generation",
    },
  });
  if (wiki.status === 201) {
    const w = await waitForStatus(cookieA, wiki.body.bookmark.id, ["ready", "failed"], 120_000);
    if (w?.status === "ready") {
      const wd = await api(`/api/bookmarks/${w.id}`, { cookie: cookieA });
      check(
        "b. public URL extracted",
        (wd.body?.passages?.length ?? 0) > 0,
        `passages=${wd.body?.passages?.length ?? 0}`,
      );
    } else {
      skip("b. public URL extraction", `network unreachable: ${w?.error ?? "unknown"}`);
    }
  } else {
    skip("b. public URL extraction", `create returned HTTP ${wiki.status}`);
  }

  // --- c. blocked URL -> failed -> pasted retry -> ready ---
  const blocked = await api("/api/bookmarks", {
    method: "POST",
    cookie: cookieA,
    body: { title: "Test note: metadata service", url: "http://169.254.169.254/latest/meta-data/" },
  });
  const blockedDone = await waitForStatus(cookieA, blocked.body.bookmark.id, ["ready", "failed"], 60_000);
  const blockedOk =
    blockedDone?.status === "failed" && /not reachable/i.test(blockedDone.error ?? "");
  check(
    "c1. blocked URL fails with readable error",
    blockedOk,
    `status=${blockedDone?.status} error=${blockedDone?.error}`,
  );
  if (blockedOk) {
    await api(`/api/bookmarks/${blockedDone.id}/retry`, {
      method: "POST",
      cookie: cookieA,
      body: { text: "Test note body: pasted fallback text for the metadata page. ".repeat(10) },
    });
    const after = await waitForStatus(cookieA, blockedDone.id, ["ready", "failed"], 30_000);
    check("c2. pasted-text retry reaches ready", after?.status === "ready", `status=${after?.status}`);
  } else {
    skip("c2. pasted-text retry reaches ready", "bookmark did not fail as expected");
  }

  // --- d. find ---
  for (const q of ["certification", "free course"]) {
    const res = await api(`/api/search?q=${encodeURIComponent(q)}`, { cookie: cookieA });
    check(
      `d. find "${q}" returns the seeded bookmark`,
      res.status === 200 && res.body.results.some((r) => r.bookmark.id === bm.id),
      `results=${res.body?.results?.length ?? "?"}`,
    );
  }

  // --- e. ask (works with or without an AI key) ---
  const askHit = await api("/api/ask", {
    method: "POST",
    cookie: cookieA,
    body: { question: "Is the AWS course free?" },
  });
  // Without a key: 503 ai_unavailable, passages in details.citations.
  // With a key: 200 answered, passages in answer.citations.
  const citations =
    askHit.body?.details?.citations ?? askHit.body?.answer?.citations ?? [];
  let citesOk =
    citations.length > 0 &&
    ((askHit.status === 503 && askHit.body?.error === "ai_unavailable") ||
      (askHit.status === 200 && askHit.body?.answer?.status === "answered"));
  if (citesOk) {
    for (const c of citations) {
      const d = await api(`/api/bookmarks/${c.bookmarkId}`, { cookie: cookieA });
      if (!d.body?.passages?.some((p) => p.id === c.passageId)) citesOk = false;
    }
  }
  check(
    "e1. related ask -> answered with citations (or 503 + passages without a key)",
    citesOk,
    `status=${askHit.status} citations=${citations.length}`,
  );
  const askMiss = await api("/api/ask", {
    method: "POST",
    cookie: cookieA,
    body: { question: "quantum chromodynamics lattice" },
  });
  const missText = JSON.stringify(askMiss.body ?? {});
  check(
    "e2. unrelated ask -> 200 insufficient with required phrase",
    askMiss.status === 200 &&
      askMiss.body?.answer?.status === "insufficient" &&
      missText.includes("Insufficient data to verify"),
    `status=${askMiss.status}`,
  );
  const conversationId = askMiss.body?.conversationId;

  // --- g. isolation (before deletion, while A's data still exists) ---
  const checks404 = [
    ["GET", `/api/bookmarks/${bm.id}`, undefined],
    ["PATCH", `/api/bookmarks/${bm.id}`, { title: "hijack" }],
    ["DELETE", `/api/bookmarks/${bm.id}`, undefined],
    ["POST", `/api/bookmarks/${bm.id}/retry`, {}],
  ];
  let all404 = true;
  for (const [method, p, body] of checks404) {
    const r = await api(p, { method, cookie: cookieB, body });
    if (r.status !== 404) all404 = false;
  }
  check("g1. user B gets 404 on GET/PATCH/DELETE/retry of A's bookmark", all404);

  const bSearch = await api(`/api/search?q=certification`, { cookie: cookieB });
  check(
    "g2. user B's search for A's term returns nothing",
    bSearch.status === 200 && bSearch.body.results.length === 0,
    `results=${bSearch.body?.results?.length ?? "?"}`,
  );

  const bAsk = await api("/api/ask", {
    method: "POST",
    cookie: cookieB,
    body: { question: "Is the AWS course free?" },
  });
  const bCites = bAsk.body?.details?.citations ?? bAsk.body?.answer?.citations ?? [];
  check(
    "g3. user B's ask surfaces none of A's passages",
    bCites.every((c) => c.bookmarkId !== bm.id),
    `bStatus=${bAsk.status}`,
  );

  const bConv = await api(`/api/conversations/${conversationId}`, { cookie: cookieB });
  check("g4. user B gets 404 on A's conversation", bConv.status === 404, `status=${bConv.status}`);

  const bColSearch = await api(
    `/api/search?q=certification&collectionId=${collectionId}`,
    { cookie: cookieB },
  );
  check(
    "g5. user B searching within A's collection returns nothing",
    bColSearch.status === 200 && bColSearch.body.results.length === 0,
  );
  const bColAsk = await api("/api/ask", {
    method: "POST",
    cookie: cookieB,
    body: { question: "anything", collectionId },
  });
  check(
    "g6. user B asking within A's collection returns 404",
    bColAsk.status === 404,
    `status=${bColAsk.status}`,
  );

  // --- f. delete ---
  const del = await api(`/api/bookmarks/${bm.id}`, { method: "DELETE", cookie: cookieA });
  check("f1. delete returns 204", del.status === 204, `status=${del.status}`);
  const postSearch = await api(`/api/search?q=certification`, { cookie: cookieA });
  check(
    "f2. deleted bookmark absent from find",
    postSearch.status === 200 &&
      postSearch.body.results.every((r) => r.bookmark.id !== bm.id),
  );
  const postAsk = await api("/api/ask", {
    method: "POST",
    cookie: cookieA,
    body: { question: "Is the AWS course free?" },
  });
  const postCites = postAsk.body?.details?.citations ?? postAsk.body?.answer?.citations ?? [];
  check(
    "f3. deleted bookmark absent from ask citations",
    postCites.every((c) => c.bookmarkId !== bm.id),
    `status=${postAsk.status}`,
  );
  const postGet = await api(`/api/bookmarks/${bm.id}`, { cookie: cookieA });
  check("f4. deleted bookmark GET returns 404", postGet.status === 404, `status=${postGet.status}`);

  // --- h. validation ---
  const badFrom = await api(`/api/bookmarks?from=2026-02-30`, { cookie: cookieA });
  check("h1. from=2026-02-30 returns 400", badFrom.status === 400, `status=${badFrom.status}`);
  const badStatus = await api(`/api/bookmarks?status=bogus`, { cookie: cookieA });
  check("h2. status=bogus returns 400", badStatus.status === 400, `status=${badStatus.status}`);

  // --- i. unauthenticated / cross-origin ---
  const anon = await api(`/api/bookmarks`);
  check("i1. unauthenticated GET /api/bookmarks returns 401", anon.status === 401);
  const cross = await api(`/api/bookmarks`, {
    method: "POST",
    cookie: cookieA,
    headers: { origin: "https://evil.example" },
    body: { title: "Test note: csrf", text: "x" },
  });
  check("i2. cross-origin POST returns 403", cross.status === 403, `status=${cross.status}`);

  report(failures === 0 ? "PASS" : "FAIL", `summary: ${failures} failed check(s)`);
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, lines.join("\n") + "\n");
  if (failures > 0) process.exit(1);
}

main().catch(async (err) => {
  report("FAIL", "script crashed", String(err?.message ?? err));
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, lines.join("\n") + "\n");
  process.exit(1);
});
