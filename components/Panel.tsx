"use client";

import { ExternalLink, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, type Bookmark, type Citation, type Collection, type Passage } from "./api";
import { STATUS_LABEL } from "./Rows";
import type { PanelState } from "./types";
import { formatDate } from "./util";

interface Detail {
  bookmark: Bookmark & { contentText: string | null };
  passages: Passage[];
}

function SourceView({
  citation,
  detail,
  onOpenDetail,
}: {
  citation: Citation;
  detail: Detail | null;
  onOpenDetail: (focusPassageId: string) => void;
}) {
  if (citation.deleted) {
    return <p className="deleted-note">This source was deleted.</p>;
  }
  const cited = detail?.passages.find((p) => p.id === citation.passageId);
  const neighbours = detail && cited
    ? detail.passages.filter((p) => Math.abs(p.ordinal - cited.ordinal) <= 1)
    : [];
  return (
    <>
      <div className="panel-meta">
        <span>{citation.domain ?? detail?.bookmark.domain ?? "Pasted text"}</span>
        <span>Saved {formatDate(citation.capturedAt ?? detail?.bookmark.capturedAt)}</span>
      </div>
      {citation.url ? (
        <a href={citation.url} target="_blank" rel="noopener noreferrer">
          Open original <ExternalLink size={13} aria-hidden="true" />
        </a>
      ) : null}
      {detail === null ? (
        <p className="status-line">Loading source…</p>
      ) : neighbours.length > 0 ? (
        <div>
          {neighbours.map((p) => (
            <div className={`passage${p.id === citation.passageId ? " cited" : ""}`} key={p.id}>
              {p.text}
            </div>
          ))}
        </div>
      ) : citation.quote ? (
        <div className="passage cited">{citation.quote}</div>
      ) : (
        <p className="status-line">The cited passage could not be found in this capture.</p>
      )}
      <div>
        <button
          type="button"
          className="btn small"
          onClick={() => onOpenDetail(citation.passageId)}
        >
          Open full capture
        </button>
      </div>
    </>
  );
}

function DetailView({
  detail,
  collections,
  focusPassageId,
  onSaved,
  onDelete,
  onRetry,
}: {
  detail: Detail;
  collections: Collection[];
  focusPassageId?: string;
  onSaved: (b: Bookmark) => void;
  onDelete: () => void;
  onRetry: (id: string, text?: string) => Promise<void>;
}) {
  const { bookmark, passages } = detail;
  const [title, setTitle] = useState(bookmark.title);
  const [note, setNote] = useState(bookmark.note ?? "");
  const [collectionId, setCollectionId] = useState(bookmark.collection?.id ?? "");
  const [tagsText, setTagsText] = useState(bookmark.tags.join(", "));
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const highlightRef = useRef<HTMLElement>(null);

  const focus = focusPassageId ? passages.find((p) => p.id === focusPassageId) : undefined;

  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: "center" });
  }, [focusPassageId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const tags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await api<{ bookmark: Bookmark }>(`/api/bookmarks/${bookmark.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: title.trim() || bookmark.title,
          note: note.trim() || null,
          collectionId: collectionId || null,
          tags,
        }),
      });
      onSaved(res.bookmark);
      setFeedback({ ok: true, text: "Changes saved." });
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof ApiError ? err.message : "Could not save changes. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    deleteDialog.current?.close();
    try {
      await api(`/api/bookmarks/${bookmark.id}`, { method: "DELETE" });
      onDelete();
    } catch {
      setFeedback({ ok: false, text: "Could not delete. Try again." });
    }
  }

  let captured = null;
  if (bookmark.contentText) {
    if (focus) {
      const before = bookmark.contentText.slice(0, focus.charStart);
      const marked = bookmark.contentText.slice(focus.charStart, focus.charEnd);
      const after = bookmark.contentText.slice(focus.charEnd);
      captured = (
        <div className="capture-text reading">
          {before}
          <mark className="sweep" ref={highlightRef}>
            {marked}
          </mark>
          {after}
        </div>
      );
    } else {
      captured = <div className="capture-text reading">{bookmark.contentText}</div>;
    }
  }

  return (
    <>
      <form className="detail-form" onSubmit={save}>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          Note
          <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label>
          Collection
          <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
            <option value="">No collection</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tags (comma-separated)
          <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
        </label>
        <div className="row-actions">
          <button type="submit" className="btn primary small" disabled={busy}>
            Save changes
          </button>
        </div>
        {feedback ? (
          <p className={`form-feedback ${feedback.ok ? "ok" : "err"}`} role="status">
            {feedback.text}
          </p>
        ) : null}
      </form>

      <div className="panel-meta">
        <span>{bookmark.domain ?? "Pasted text"}</span>
        <span>Saved {formatDate(bookmark.capturedAt)}</span>
        <span className="row-status">
          <span className={`status-dot ${bookmark.status}`} aria-hidden="true" />
          <span className={`status-text ${bookmark.status}`}>
            {STATUS_LABEL[bookmark.status]}
          </span>
        </span>
      </div>
      {bookmark.url ? (
        <a href={bookmark.url} target="_blank" rel="noopener noreferrer">
          Open original <ExternalLink size={13} aria-hidden="true" />
        </a>
      ) : null}

      {bookmark.status === "failed" ? (
        <div>
          <p className="row-error">{bookmark.error ?? "Processing failed."}</p>
          <div className="row-actions">
            <button
              type="button"
              className="btn small"
              disabled={busy}
              onClick={() => void onRetry(bookmark.id)}
            >
              <RotateCcw size={14} /> Retry
            </button>
            <button type="button" className="btn small" onClick={() => setPasteOpen((v) => !v)}>
              Paste text
            </button>
          </div>
          {pasteOpen ? (
            <div className="paste-area">
              <label className="visually-hidden" htmlFor="panel-paste">
                Paste the page text
              </label>
              <textarea
                id="panel-paste"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <button
                type="button"
                className="btn primary small"
                disabled={busy || !pasteText.trim()}
                onClick={() => void onRetry(bookmark.id, pasteText)}
              >
                Save pasted text
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {captured ?? (bookmark.status !== "failed" ? <p className="status-line">No captured text yet.</p> : null)}

      <div>
        <button
          type="button"
          className="btn danger small"
          onClick={() => deleteDialog.current?.showModal()}
        >
          Delete this bookmark
        </button>
      </div>

      <dialog
        ref={deleteDialog}
        aria-labelledby="delete-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") e.stopPropagation();
        }}
      >
        <div className="dialog-inner">
          <h2 className="dialog-title" id="delete-title">
            Delete “{bookmark.title}”?
          </h2>
          <p className="confirm-text">
            The saved page and its passages will be removed. It will no longer appear in Find or
            Ask.
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              className="btn"
              onClick={() => deleteDialog.current?.close()}
            >
              Keep it
            </button>
            <button type="button" className="btn danger" onClick={() => void confirmDelete()}>
              Delete
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

export default function Panel({
  state,
  collections,
  onClose,
  onOpenDetail,
  onSaved,
  onDeleted,
  onRetry,
}: {
  state: NonNullable<PanelState>;
  collections: Collection[];
  onClose: () => void;
  onOpenDetail: (bookmarkId: string, focusPassageId?: string) => void;
  onSaved: (b: Bookmark) => void;
  onDeleted: (id: string) => void;
  onRetry: (id: string, text?: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const bookmarkId = state.kind === "source" ? state.citation.bookmarkId : state.bookmarkId;
  const deleted = state.kind === "source" && state.citation.deleted === true;

  useEffect(() => {
    headingRef.current?.focus();
    if (deleted) return;
    let cancelled = false;
    api<{ bookmark: Bookmark & { contentText: string | null }; passages: Passage[] }>(
      `/api/bookmarks/${bookmarkId}`,
    )
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : "Could not load this bookmark.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bookmarkId, deleted]);

  const title =
    state.kind === "source"
      ? (state.citation.title ?? detail?.bookmark.title ?? "Source")
      : (detail?.bookmark.title ?? "Bookmark");

  return (
    <aside
      className="panel"
      aria-label={state.kind === "source" ? "Source" : "Bookmark details"}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="panel-head">
        <h2 className="panel-title" ref={headingRef} tabIndex={-1}>
          {title}
        </h2>
        <button type="button" className="rail-icon-btn" aria-label="Close panel" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="panel-body">
        {loadError ? (
          <div className="error-box">
            <p>{loadError}</p>
          </div>
        ) : state.kind === "source" ? (
          <SourceView
            citation={state.citation}
            detail={detail}
            onOpenDetail={(pid) => onOpenDetail(bookmarkId, pid)}
          />
        ) : detail ? (
          <DetailView
            detail={detail}
            collections={collections}
            focusPassageId={state.focusPassageId}
            onSaved={(b) => {
              onSaved(b);
              setDetail({ ...detail, bookmark: { ...detail.bookmark, ...b } });
            }}
            onDelete={() => onDeleted(bookmarkId)}
            onRetry={onRetry}
          />
        ) : (
          <p className="status-line">Loading…</p>
        )}
      </div>
    </aside>
  );
}
