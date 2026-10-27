import type { Answer, Bookmark, Citation } from "./api";

export type Mode = "find" | "ask";

export interface Filters {
  view: "all" | "failed";
  collectionId: string | null;
  tags: string[];
  from: string;
  to: string;
}

export const EMPTY_FILTERS: Filters = {
  view: "all",
  collectionId: null,
  tags: [],
  from: "",
  to: "",
};

export type PanelState =
  | { kind: "source"; citation: Citation }
  | { kind: "detail"; bookmarkId: string; focusPassageId?: string }
  | null;

export interface Exchange {
  id: string;
  question: string;
  answer?: Answer;
  unavailable?: { message: string; citations: Citation[] };
  failed?: { message: string };
}

export interface FindState {
  q: string;
  results: { bookmark: Bookmark; score: number; excerpt: string; passageId: string; matched: "keyword" | "semantic" | "both" }[];
  semantic: boolean;
}
