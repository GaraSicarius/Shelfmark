"use client";

import { Check, Pencil, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Collection, ConversationSummary, Tag } from "./api";
import type { Filters, Mode } from "./types";

interface RailProps {
  collections: Collection[];
  tags: Tag[];
  conversations: ConversationSummary[];
  filters: Filters;
  mode: Mode;
  failedCount: number;
  onFilters: (filters: Filters) => void;
  onCreateCollection: (name: string) => Promise<void>;
  onRenameCollection: (id: string, name: string) => Promise<void>;
  onDeleteCollection: (id: string) => Promise<void>;
  onOpenConversation: (id: string) => void;
  onNewQuestion: () => void;
}

export default function Rail({
  collections,
  tags,
  conversations,
  filters,
  mode,
  failedCount,
  onFilters,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onOpenConversation,
  onNewQuestion,
}: RailProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      await onCreateCollection(name);
      setNewName("");
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the collection.");
    }
  }

  async function submitRename(id: string) {
    const name = editName.trim();
    if (!name) {
      setEditingId(null);
      return;
    }
    setError(null);
    try {
      await onRenameCollection(id, name);
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename the collection.");
    }
  }

  function toggleTag(name: string) {
    const next = filters.tags.includes(name)
      ? filters.tags.filter((t) => t !== name)
      : [...filters.tags, name];
    onFilters({ ...filters, tags: next });
  }

  const hasFilters =
    filters.view !== "all" ||
    filters.collectionId !== null ||
    filters.tags.length > 0 ||
    filters.from !== "" ||
    filters.to !== "";

  return (
    <div>
      <div className="rail-section">
        <h2 className="rail-heading">Library</h2>
        <ul className="rail-list">
          <li className="rail-item">
            <button
              type="button"
              className={`rail-link${filters.view === "all" && !hasFilters ? " active" : ""}`}
              onClick={() =>
                onFilters({ view: "all", collectionId: null, tags: [], from: "", to: "" })
              }
            >
              <span className="rail-name">All</span>
            </button>
          </li>
          <li className="rail-item">
            <button
              type="button"
              className={`rail-link${filters.view === "failed" ? " active" : ""}`}
              onClick={() => onFilters({ ...filters, view: "failed" })}
            >
              <span className="rail-name">Failed</span>
              <span className="rail-count">{failedCount}</span>
            </button>
          </li>
        </ul>
        {hasFilters ? (
          <button
            type="button"
            className="btn ghost small"
            onClick={() =>
              onFilters({ view: "all", collectionId: null, tags: [], from: "", to: "" })
            }
          >
            Clear filters
          </button>
        ) : null}
        {mode === "ask" && hasFilters && (filters.tags.length > 0 || filters.from || filters.to) ? (
          <p className="rail-note">Tag and date filters apply to Find, not Ask.</p>
        ) : null}
      </div>

      <div className="rail-section">
        <h2 className="rail-heading">Collections</h2>
        <ul className="rail-list">
          {collections.map((c) => (
            <li className="rail-item" key={c.id}>
              {editingId === c.id ? (
                <>
                  <input
                    aria-label={`Rename ${c.name}`}
                    value={editName}
                    autoFocus
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void submitRename(c.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                  <button
                    type="button"
                    className="rail-icon-btn"
                    aria-label="Save name"
                    onClick={() => void submitRename(c.id)}
                  >
                    <Check size={15} />
                  </button>
                  <button
                    type="button"
                    className="rail-icon-btn"
                    aria-label="Cancel renaming"
                    onClick={() => setEditingId(null)}
                  >
                    <X size={15} />
                  </button>
                </>
              ) : confirmDeleteId === c.id ? (
                <>
                  <span className="rail-name">Delete {c.name}?</span>
                  <button
                    type="button"
                    className="rail-icon-btn"
                    aria-label={`Confirm delete ${c.name}`}
                    onClick={() => {
                      setConfirmDeleteId(null);
                      void onDeleteCollection(c.id).catch((err) =>
                        setError(err instanceof Error ? err.message : "Delete failed."),
                      );
                    }}
                  >
                    <Check size={15} />
                  </button>
                  <button
                    type="button"
                    className="rail-icon-btn"
                    aria-label="Cancel delete"
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    <X size={15} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={`rail-link${filters.collectionId === c.id ? " active" : ""}`}
                    onClick={() =>
                      onFilters({
                        ...filters,
                        collectionId: filters.collectionId === c.id ? null : c.id,
                      })
                    }
                  >
                    <span className="rail-name">{c.name}</span>
                    <span className="rail-count">{c.count}</span>
                  </button>
                  <button
                    type="button"
                    className="rail-icon-btn"
                    aria-label={`Rename ${c.name}`}
                    onClick={() => {
                      setEditingId(c.id);
                      setEditName(c.name);
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="rail-icon-btn"
                    aria-label={`Delete ${c.name}`}
                    onClick={() => setConfirmDeleteId(c.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {creating ? (
          <form className="inline-create" onSubmit={submitCreate}>
            <input
              aria-label="New collection name"
              placeholder="Collection name"
              value={newName}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setCreating(false);
              }}
            />
            <button type="submit" className="btn small">
              Add
            </button>
          </form>
        ) : (
          <button type="button" className="btn ghost small" onClick={() => setCreating(true)}>
            New collection
          </button>
        )}
        {error ? <p className="rail-note">{error}</p> : null}
      </div>

      {tags.length > 0 ? (
        <div className="rail-section">
          <h2 className="rail-heading">Tags</h2>
          <div className="chip-row">
            {tags.map((t) => (
              <button
                type="button"
                key={t.name}
                className={`tag-chip${filters.tags.includes(t.name) ? " active" : ""}`}
                aria-pressed={filters.tags.includes(t.name)}
                onClick={() => toggleTag(t.name)}
              >
                {t.name}
                <span className="count">{t.count}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rail-section">
        <h2 className="rail-heading">Saved date</h2>
        <div className="date-fields">
          <label>
            From
            <input
              type="date"
              value={filters.from}
              onChange={(e) => onFilters({ ...filters, from: e.target.value })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={filters.to}
              onChange={(e) => onFilters({ ...filters, to: e.target.value })}
            />
          </label>
        </div>
      </div>

      <div className="rail-section">
        <h2 className="rail-heading">Recent questions</h2>
        <ul className="rail-list">
          {conversations.slice(0, 8).map((c) => (
            <li className="rail-item" key={c.id}>
              <button
                type="button"
                className="rail-link"
                onClick={() => onOpenConversation(c.id)}
              >
                <span className="rail-name">{c.title ?? "Question"}</span>
              </button>
            </li>
          ))}
          {conversations.length === 0 ? (
            <li>
              <p className="rail-note">Questions you ask appear here.</p>
            </li>
          ) : null}
        </ul>
        <button type="button" className="btn ghost small" onClick={onNewQuestion}>
          New question
        </button>
      </div>
    </div>
  );
}
