export class ApiError extends Error {
  readonly status: number;
  readonly error: string;
  readonly details: unknown;

  constructor(status: number, error: string, message: string, details: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.error = error;
    this.details = details;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    location.assign("/login");
    throw new ApiError(401, "unauthorized", "Your session has ended. Sign in again.", undefined);
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as
    | { error?: string; message?: string; details?: unknown }
    | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error ?? "internal",
      body?.message ?? `Request failed (HTTP ${res.status}).`,
      body?.details,
    );
  }
  return body as T;
}

export type Status = "pending" | "processing" | "ready" | "failed";

export interface Bookmark {
  id: string;
  sourceType: "url" | "text";
  url: string | null;
  domain: string | null;
  title: string;
  note: string | null;
  collection: { id: string; name: string } | null;
  tags: string[];
  status: Status;
  error: string | null;
  attempts: number;
  semanticIndexed: boolean;
  excerpt: string | null;
  capturedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Passage {
  id: string;
  ordinal: number;
  text: string;
  charStart: number;
  charEnd: number;
}

export interface Citation {
  n: number;
  passageId: string;
  bookmarkId: string;
  title?: string;
  url?: string | null;
  domain?: string | null;
  capturedAt?: string | null;
  quote?: string;
  deleted?: true;
}

export interface Segment {
  kind: "fact" | "suggestion" | "interpretation";
  text: string;
  citations: number[];
  uncited?: true;
}

export interface Answer {
  status: "answered" | "insufficient";
  segments: Segment[];
  conflicts: { description: string; citations: number[] }[];
  gaps: string[];
  followUps: string[];
  citations: Citation[];
  retrieval: { semantic: boolean; passages: number };
}

export interface Collection {
  id: string;
  name: string;
  count: number;
}

export interface Tag {
  name: string;
  count: number;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  collectionId: string | null;
  updatedAt: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  answer?: Answer;
  createdAt: string;
}

export interface SearchResult {
  bookmark: Bookmark;
  score: number;
  excerpt: string;
  passageId: string;
  matched: "keyword" | "semantic" | "both";
}

export interface User {
  id: string;
  email: string;
}
