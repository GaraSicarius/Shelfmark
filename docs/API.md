# API

All endpoints are Next.js Route Handlers under `/api`. JSON in, JSON out.

- **Auth:** an httpOnly `session` cookie set by `/api/auth/signup` or `/api/auth/login`. Every endpoint except signup/login returns `401 {"error":"unauthorized"}` without a valid session.
- **Mutations** (`POST`/`PATCH`/`DELETE`) require `Content-Type: application/json` (DELETE may omit a body) and a same-origin `Origin` header when one is sent. Otherwise: `403 {"error":"forbidden"}`.
- **Ownership:** resources owned by another user return `404 {"error":"not_found"}`.
- **Error shape:** `{ "error": "<code>", "message"?: "<human text>", "details"?: any }`. Codes: `unauthorized` 401, `forbidden` 403, `not_found` 404, `validation` 400, `duplicate` 409, `conflict` 409, `rate_limited` 429, `ai_unavailable` 503, `internal` 500.
- **Query filters:** `from`/`to` must be real `YYYY-MM-DD` dates and `status` one of `pending|processing|ready|failed`; anything else returns `400 {"error":"validation"}`.

## Types

```ts
type Status = "pending" | "processing" | "ready" | "failed";

type Bookmark = {
  id: string; sourceType: "url" | "text";
  url: string | null; domain: string | null;
  title: string; note: string | null;
  collection: { id: string; name: string } | null;
  tags: string[];                 // tag names
  status: Status; error: string | null; attempts: number;
  semanticIndexed: boolean;       // true when its passages have embeddings
  excerpt: string | null;         // first ~240 chars of captured text
  capturedAt: string | null;      // ISO
  createdAt: string; updatedAt: string;
};

type Passage = { id: string; ordinal: number; text: string; charStart: number; charEnd: number };

type Citation = {
  n: number; passageId: string; bookmarkId: string;
  title: string; url: string | null; domain: string | null;
  capturedAt: string | null; quote: string;   // full passage text
  deleted?: true;                              // set when the source was deleted later
};

type Answer = {
  status: "answered" | "insufficient";
  segments: { kind: "fact" | "suggestion" | "interpretation"; text: string; citations: number[]; uncited?: true }[];
  conflicts: { description: string; citations: number[] }[];
  gaps: string[];
  followUps: string[];
  citations: Citation[];
  retrieval: { semantic: boolean; passages: number };
};
```

## Auth

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| POST | `/api/auth/signup` | `{ email, password }` (password ≥ 8 chars) | `201 { user: { id, email } }` + cookie. `409 duplicate` if email exists. |
| POST | `/api/auth/login` | `{ email, password }` | `200 { user }` + cookie. `401 unauthorized` on bad credentials. `429 rate_limited` after 10 failures/15 min per email+IP. |
| POST | `/api/auth/logout` | – | `204`, session row deleted, cookie cleared. |
| GET | `/api/auth/me` | – | `200 { user }` |

## Bookmarks

| Method | Path | Body / query | Success |
| --- | --- | --- | --- |
| GET | `/api/bookmarks` | `?collectionId=&tag=&from=YYYY-MM-DD&to=YYYY-MM-DD&status=` | `200 { bookmarks: Bookmark[] }` newest first. Also re-schedules stale jobs. |
| POST | `/api/bookmarks` | `{ url?: string, text?: string, title?: string, note?: string, collectionId?: string, tags?: string[] }`, exactly one of `url`/`text`. `title` required for `text`. | `201 { bookmark }` (status `pending`). `409 { error: "duplicate", bookmark }`. |
| GET | `/api/bookmarks/:id` | – | `200 { bookmark: Bookmark & { contentText: string \| null }, passages: Passage[] }` |
| PATCH | `/api/bookmarks/:id` | any of `{ title, note, collectionId (string\|null), tags (string[]) }` | `200 { bookmark }` |
| DELETE | `/api/bookmarks/:id` | – | `204`. Passages cascade-delete; excluded from all future search/ask. |
| POST | `/api/bookmarks/:id/retry` | optional `{ text: string }` pasted-text fallback | `202 { bookmark }` (status `pending`). `409 conflict` while `processing`. |

## Collections and tags

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| GET | `/api/collections` | – | `200 { collections: { id, name, count }[] }` |
| POST | `/api/collections` | `{ name }` | `201 { collection }`; `409 duplicate` |
| PATCH | `/api/collections/:id` | `{ name }` | `200 { collection }` |
| DELETE | `/api/collections/:id` | – | `204`; its bookmarks become uncollected |
| GET | `/api/tags` | – | `200 { tags: { name, count }[] }` |

## Find

`GET /api/search?q=<text>&collectionId=&tag=&from=&to=` (`q` required, 1–500 chars)

```json
200 { "results": [ { "bookmark": Bookmark, "score": 0.032, "excerpt": "…passage text…",
                     "passageId": "…", "matched": "keyword" | "semantic" | "both" } ],
      "semantic": true }
```

## Ask

`POST /api/ask` `{ question: string (1–2000), conversationId?: string, collectionId?: string }`

```json
200 { "conversationId": "…", "messageId": "…", "answer": Answer }
```

`503 ai_unavailable` when passages were found but no AI key is configured, or when the model call fails (the provider error is logged server-side, never returned; the response includes `details.citations` with the retrieved passages so the user can still read them). An empty retrieval always returns `200` with `answer.status = "insufficient"` and no model call.

## Conversations

| Method | Path | Success |
| --- | --- | --- |
| GET | `/api/conversations` | `200 { conversations: { id, title, collectionId, updatedAt }[] }` |
| GET | `/api/conversations/:id` | `200 { conversation, messages: { id, role, content, answer?: Answer, createdAt }[] }` (citations re-resolved; deleted sources flagged) |
| DELETE | `/api/conversations/:id` | `204` |
