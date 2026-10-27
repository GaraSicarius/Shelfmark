"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, type Bookmark, type Collection } from "./api";

export default function SaveDialog({
  open,
  collections,
  onClose,
  onSaved,
  onOpenBookmark,
}: {
  open: boolean;
  collections: Collection[];
  onClose: () => void;
  onSaved: (b: Bookmark) => void;
  onOpenBookmark: (id: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Bookmark | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setTab("url");
      setUrl("");
      setTitle("");
      setText("");
      setNote("");
      setCollectionId("");
      setTagsText("");
      setError(null);
      setDuplicate(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDuplicate(null);
    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const body =
      tab === "url"
        ? {
            url: url.trim(),
            ...(title.trim() ? { title: title.trim() } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
            ...(collectionId ? { collectionId } : {}),
            ...(tags.length ? { tags } : {}),
          }
        : {
            text,
            title: title.trim(),
            ...(note.trim() ? { note: note.trim() } : {}),
            ...(collectionId ? { collectionId } : {}),
            ...(tags.length ? { tags } : {}),
          };
    setBusy(true);
    try {
      const res = await api<{ bookmark: Bookmark }>("/api/bookmarks", {
        method: "POST",
        body: JSON.stringify(body),
      });
      onSaved(res.bookmark);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const existing = (err.details as { bookmark?: Bookmark } | undefined)?.bookmark;
        setDuplicate(existing ?? null);
        setError("Already saved.");
      } else {
        setError(err instanceof ApiError ? err.message : "Could not save. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="save-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <div className="dialog-inner">
        <h2 className="dialog-title" id="save-title">
          Save to your library
        </h2>
        <div className="dialog-tabs" role="tablist" aria-label="Save method">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "url"}
            onClick={() => setTab("url")}
          >
            Web page
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "text"}
            onClick={() => setTab("text")}
          >
            Paste text
          </button>
        </div>
        <form className="dialog-form" onSubmit={submit}>
          {tab === "url" ? (
            <>
              <label>
                Page URL
                <input
                  type="url"
                  required
                  placeholder="https://…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </label>
              <p className="dialog-note">
                Pages that need sign-in or sit behind a paywall cannot be fetched — use Paste text
                for those.
              </p>
            </>
          ) : (
            <>
              <label>
                Title
                <input required value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label>
                Text
                <textarea required value={text} onChange={(e) => setText(e.target.value)} />
              </label>
            </>
          )}
          {tab === "url" ? (
            <label>
              Title (optional — taken from the page if empty)
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
          ) : null}
          <label>
            Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} />
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
          {error ? (
            <p className="row-error" role="alert">
              {error}{" "}
              {duplicate ? (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => onOpenBookmark(duplicate.id)}
                >
                  Open it
                </button>
              ) : null}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
