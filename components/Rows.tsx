"use client";

import { RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Bookmark, SearchResult } from "./api";
import { excerptWithMarks, formatDate } from "./util";

export const STATUS_LABEL: Record<Bookmark["status"], string> = {
  pending: "Pending",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

interface RowProps {
  bookmark: Bookmark;
  result?: SearchResult;
  q?: string;
  onOpen: (bookmarkId: string) => void;
  onRetry: (id: string, text?: string) => Promise<void>;
}

function Row({ bookmark, result, q, onOpen, onRetry }: RowProps) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function retry(text?: string) {
    setBusy(true);
    setActionError(null);
    try {
      await onRetry(bookmark.id, text);
      setPasteOpen(false);
      setPasteText("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Retry failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  let excerpt: ReactNode = null;
  if (result && q !== undefined) {
    const { prefix, suffix, nodes } = excerptWithMarks(result.excerpt, q);
    excerpt = (
      <p className="row-excerpt">
        {prefix}
        {nodes}
        {suffix}
      </p>
    );
  }

  return (
    <li className="row">
      <div className="row-top">
        <button type="button" className="row-title" onClick={() => onOpen(bookmark.id)}>
          {bookmark.title}
        </button>
        <span className="row-domain">{bookmark.domain ?? "Pasted text"}</span>
        <span className="row-date">{formatDate(bookmark.capturedAt ?? bookmark.createdAt)}</span>
      </div>
      {bookmark.tags.length > 0 ? (
        <div className="row-tags">
          {bookmark.tags.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      ) : null}
      <div className="row-status">
        <span className={`status-dot ${bookmark.status}`} aria-hidden="true" />
        <span className={`status-text ${bookmark.status}`}>
          {bookmark.status === "processing"
            ? `Processing — attempt ${bookmark.attempts}`
            : STATUS_LABEL[bookmark.status]}
        </span>
        {result ? (
          <span className="match-note">
            {result.matched === "keyword"
              ? "Matched words"
              : result.matched === "semantic"
                ? "Matched meaning"
                : "Matched words and meaning"}
          </span>
        ) : null}
      </div>
      {bookmark.status === "failed" ? (
        <>
          <p className="row-error">{bookmark.error ?? "Processing failed."}</p>
          <div className="row-actions">
            <button
              type="button"
              className="btn small"
              disabled={busy}
              onClick={() => void retry()}
            >
              <RotateCcw size={14} /> Retry
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => setPasteOpen((v) => !v)}
            >
              Paste text
            </button>
          </div>
          {pasteOpen ? (
            <div className="paste-area">
              <label className="visually-hidden" htmlFor={`paste-${bookmark.id}`}>
                Paste the page text
              </label>
              <textarea
                id={`paste-${bookmark.id}`}
                placeholder="Paste the page text here…"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <div className="row-actions">
                <button
                  type="button"
                  className="btn primary small"
                  disabled={busy || pasteText.trim().length === 0}
                  onClick={() => void retry(pasteText)}
                >
                  Save pasted text
                </button>
              </div>
            </div>
          ) : null}
          {actionError ? <p className="row-error">{actionError}</p> : null}
        </>
      ) : null}
      {excerpt}
    </li>
  );
}

interface RowsProps {
  bookmarks?: Bookmark[];
  results?: SearchResult[];
  q?: string;
  onOpen: (bookmarkId: string) => void;
  onRetry: (id: string, text?: string) => Promise<void>;
}

export function SkeletonRows() {
  return (
    <ul className="rows skeleton" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <li className="row" key={i}>
          <span className="sk title" />
          <span className="sk sub" />
        </li>
      ))}
    </ul>
  );
}

export default function Rows({ bookmarks, results, q, onOpen, onRetry }: RowsProps) {
  if (results) {
    return (
      <ul className="rows">
        {results.map((r) => (
          <Row
            key={r.bookmark.id}
            bookmark={r.bookmark}
            result={r}
            q={q}
            onOpen={onOpen}
            onRetry={onRetry}
          />
        ))}
      </ul>
    );
  }
  return (
    <ul className="rows">
      {(bookmarks ?? []).map((b) => (
        <Row key={b.id} bookmark={b} onOpen={onOpen} onRetry={onRetry} />
      ))}
    </ul>
  );
}
