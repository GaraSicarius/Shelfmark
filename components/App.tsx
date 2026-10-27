"use client";

import { Loader2, Plus, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  type Bookmark,
  type Citation,
  type Collection,
  type ConversationSummary,
  type Message,
  type SearchResult,
  type Tag,
  type User,
} from "./api";
import AnswerView from "./AnswerView";
import Panel from "./Panel";
import Rail from "./Rail";
import Rows, { SkeletonRows } from "./Rows";
import SaveDialog from "./SaveDialog";
import { EMPTY_FILTERS, type Exchange, type Filters, type Mode, type PanelState } from "./types";

interface FindResult {
  state: "idle" | "loading" | "done" | "error";
  q: string;
  results: SearchResult[];
  semantic: boolean;
  message?: string;
}

const IDLE_FIND: FindResult = { state: "idle", q: "", results: [], semantic: true };

function bookmarksQuery(filters: Filters): string {
  const p = new URLSearchParams();
  if (filters.collectionId) p.set("collectionId", filters.collectionId);
  if (filters.tags[0]) p.set("tag", filters.tags[0]);
  if (filters.from) p.set("from", filters.from);
  if (filters.to) p.set("to", filters.to);
  if (filters.view === "failed") p.set("status", "failed");
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [libState, setLibState] = useState<"loading" | "ready" | "error">("loading");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [mode, setMode] = useState<Mode>("find");
  const [query, setQuery] = useState("");
  const [find, setFind] = useState<FindResult>(IDLE_FIND);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [askLoading, setAskLoading] = useState(false);
  const [panel, setPanel] = useState<PanelState>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const filtersDialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  const lastAsk = useRef("");

  const refreshBookmarks = useCallback(async (f: Filters, quiet = false) => {
    if (!quiet) setLibState("loading");
    try {
      const res = await api<{ bookmarks: Bookmark[] }>(`/api/bookmarks${bookmarksQuery(f)}`);
      setBookmarks(res.bookmarks);
      setLibState("ready");
    } catch {
      if (!quiet) setLibState("error");
    }
  }, []);

  const refreshMeta = useCallback(async () => {
    const [cols, tgs, convs] = await Promise.all([
      api<{ collections: Collection[] }>("/api/collections"),
      api<{ tags: Tag[] }>("/api/tags"),
      api<{ conversations: ConversationSummary[] }>("/api/conversations"),
    ]);
    setCollections(cols.collections);
    setTags(tgs.tags);
    setConversations(convs.conversations);
  }, []);

  useEffect(() => {
    void Promise.all([api<{ user: User }>("/api/auth/me"), refreshMeta()])
      .then(([me]) => setUser(me.user))
      .catch(() => {});
    void refreshBookmarks(EMPTY_FILTERS);
  }, [refreshMeta, refreshBookmarks]);

  // Re-fetch when server-supported filters change.
  useEffect(() => {
    void refreshBookmarks(filters, true);
  }, [filters, refreshBookmarks]);

  // Poll every 2 s while any bookmark is still processing.
  useEffect(() => {
    if (!bookmarks.some((b) => b.status === "pending" || b.status === "processing")) return;
    const t = setInterval(() => void refreshBookmarks(filters, true), 2000);
    return () => clearInterval(t);
  }, [bookmarks, filters, refreshBookmarks]);

  // "/" focuses the search field unless already typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable], dialog")) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const d = filtersDialogRef.current;
    if (!d) return;
    if (filtersOpen && !d.open) d.showModal();
    else if (!filtersOpen && d.open) d.close();
  }, [filtersOpen]);

  // Tags beyond the first (the API accepts one) are applied client-side.
  const visibleBookmarks = bookmarks.filter(
    (b) => filters.tags.slice(1).every((t) => b.tags.includes(t)),
  );
  const failedCount = bookmarks.filter((b) => b.status === "failed").length;

  async function doFind() {
    if (find.state === "loading") return;
    const q = query.trim();
    if (!q) {
      setFind(IDLE_FIND);
      return;
    }
    setFind({ state: "loading", q, results: [], semantic: true });
    try {
      const res = await api<{ results: SearchResult[]; semantic: boolean }>(
        `/api/search?q=${encodeURIComponent(q)}${filters.collectionId ? `&collectionId=${filters.collectionId}` : ""}${filters.tags[0] ? `&tag=${encodeURIComponent(filters.tags[0])}` : ""}${filters.from ? `&from=${filters.from}` : ""}${filters.to ? `&to=${filters.to}` : ""}`,
      );
      const results = res.results.filter((r) =>
        filters.tags.slice(1).every((t) => r.bookmark.tags.includes(t)),
      );
      setFind({ state: "done", q, results, semantic: res.semantic });
      setAnnounce(
        results.length === 0
          ? `No results for ${q}.`
          : `${results.length} result${results.length === 1 ? "" : "s"} for ${q}.`,
      );
    } catch (err) {
      setFind({
        state: "error",
        q,
        results: [],
        semantic: true,
        message: err instanceof ApiError ? err.message : "Search failed. Try again.",
      });
    }
  }

  async function doAsk(question: string) {
    if (askLoading) return;
    const q = question.trim();
    if (!q) return;
    lastAsk.current = q;
    setAnnounce("Generating answer…");
    const id = crypto.randomUUID();
    setExchanges((prev) => [...prev, { id, question: q }]);
    setAskLoading(true);
    try {
      const res = await api<{ conversationId: string; answer: Exchange["answer"] }>("/api/ask", {
        method: "POST",
        body: JSON.stringify({
          question: q,
          ...(conversationId ? { conversationId } : {}),
          ...(filters.collectionId ? { collectionId: filters.collectionId } : {}),
        }),
      });
      setConversationId(res.conversationId);
      setExchanges((prev) => prev.map((e) => (e.id === id ? { ...e, answer: res.answer } : e)));
      setAnnounce("Answer ready.");
      void refreshMeta();
    } catch (err) {
      if (err instanceof ApiError && err.error === "ai_unavailable") {
        const details = err.details as { citations?: Citation[] } | undefined;
        setExchanges((prev) =>
          prev.map((e) =>
            e.id === id
              ? {
                  ...e,
                  unavailable: {
                    message:
                      err.message ||
                      "Answer generation is not available because no AI key is configured.",
                    citations: details?.citations ?? [],
                  },
                }
              : e,
          ),
        );
      } else {
        setExchanges((prev) =>
          prev.map((e) =>
            e.id === id
              ? {
                  ...e,
                  failed: {
                    message:
                      err instanceof ApiError
                        ? err.message
                        : "The request failed. Check your connection and try again.",
                  },
                }
              : e,
          ),
        );
      }
      setAnnounce("The question could not be answered.");
    } finally {
      setAskLoading(false);
    }
  }

  function submitSearch() {
    if (mode === "find") void doFind();
    else {
      void doAsk(query);
      if (!askLoading) setQuery("");
    }
  }

  async function openConversation(id: string) {
    try {
      const res = await api<{ messages: Message[] }>(`/api/conversations/${id}`);
      const next: Exchange[] = [];
      for (let i = 0; i < res.messages.length; i++) {
        const m = res.messages[i];
        if (m.role !== "user") continue;
        const reply = res.messages.slice(i + 1).find((x) => x.role === "assistant");
        next.push({ id: m.id, question: m.content, answer: reply?.answer });
      }
      setMode("ask");
      setConversationId(id);
      setExchanges(next);
    } catch {
      setAnnounce("Could not load that conversation.");
    }
  }

  function openPanel(next: NonNullable<PanelState>) {
    restoreFocusRef.current = document.activeElement;
    setPanel(next);
  }

  function closePanel() {
    setPanel(null);
    const el = restoreFocusRef.current;
    if (el instanceof HTMLElement) el.focus();
  }

  async function retryBookmark(id: string, text?: string) {
    const res = await api<{ bookmark: Bookmark }>(`/api/bookmarks/${id}/retry`, {
      method: "POST",
      body: JSON.stringify(text !== undefined ? { text } : {}),
    });
    setBookmarks((prev) => prev.map((b) => (b.id === id ? res.bookmark : b)));
    setAnnounce("Retrying.");
  }

  async function signOut() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // Session may already be gone; either way, leave.
    }
    location.assign("/login");
  }

  const collectionName = filters.collectionId
    ? (collections.find((c) => c.id === filters.collectionId)?.name ?? "collection")
    : null;

  const rail = (
    <Rail
      collections={collections}
      tags={tags}
      conversations={conversations}
      filters={filters}
      mode={mode}
      failedCount={failedCount}
      onFilters={setFilters}
      onCreateCollection={async (name) => {
        await api("/api/collections", { method: "POST", body: JSON.stringify({ name }) });
        await refreshMeta();
      }}
      onRenameCollection={async (id, name) => {
        await api(`/api/collections/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
        await Promise.all([refreshMeta(), refreshBookmarks(filters, true)]);
      }}
      onDeleteCollection={async (id) => {
        await api(`/api/collections/${id}`, { method: "DELETE" });
        if (filters.collectionId === id) setFilters((f) => ({ ...f, collectionId: null }));
        await Promise.all([refreshMeta(), refreshBookmarks(filters, true)]);
        setAnnounce("Collection deleted.");
      }}
      onOpenConversation={openConversation}
      onNewQuestion={() => {
        setMode("ask");
        setConversationId(null);
        setExchanges([]);
      }}
    />
  );

  const showingAsk = mode === "ask";
  const showingFindResults = mode === "find" && find.state !== "idle";
  const submitBusy = mode === "ask" ? askLoading : find.state === "loading";

  return (
    <>
      <header className="app-header">
        <button
          type="button"
          className="btn small filters-open"
          aria-label="Open filters"
          onClick={() => setFiltersOpen(true)}
        >
          <SlidersHorizontal size={15} /> Filters
        </button>
        <Link className="brand" href="/">
          Shelfmark
        </Link>
        <button type="button" className="btn primary" onClick={() => setSaveOpen(true)}>
          <Plus size={16} /> Save
        </button>
        {user ? <span className="header-user">{user.email}</span> : null}
        <button type="button" className="btn small" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>

      <div className="app-body">
        <nav className="rail" aria-label="Library filters">
          {rail}
        </nav>

        <main className="main">
          <div className="search-row">
            <div className="mode-switch" role="radiogroup" aria-label="Search mode">
              {(["find", "ask"] as const).map((m) => (
                <label key={m}>
                  <input
                    type="radio"
                    name="mode"
                    value={m}
                    checked={mode === m}
                    onChange={() => setMode(m)}
                  />
                  {m === "find" ? "Find" : "Ask"}
                </label>
              ))}
            </div>
            <input
              ref={searchRef}
              className="search-input"
              type="search"
              value={query}
              placeholder={
                mode === "find" ? "Find a saved page…" : "Ask about your saved pages…"
              }
              aria-label={mode === "find" ? "Find a saved page" : "Ask about your saved pages"}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitSearch();
              }}
            />
            <button
              type="button"
              className="btn primary"
              disabled={submitBusy}
              aria-busy={submitBusy || undefined}
              onClick={submitSearch}
            >
              {submitBusy ? <Loader2 size={15} className="spin" /> : <Search size={15} />}{" "}
              {mode === "find" ? (submitBusy ? "Finding…" : "Find") : submitBusy ? "Asking…" : "Ask"}
            </button>
          </div>
          {showingAsk ? (
            <p className="ask-scope">
              {collectionName
                ? `Asking within: ${collectionName}`
                : "Asking across your whole library"}
            </p>
          ) : null}

          {showingAsk ? (
            exchanges.length === 0 && !askLoading ? (
              <p className="status-line">
                Ask a question about your saved pages. Answers cite the passages they come from.
              </p>
            ) : (
              <AnswerView
                exchanges={exchanges}
                onCitation={(c) => openPanel({ kind: "source", citation: c })}
                onFollowUp={(q) => {
                  setQuery(q);
                  void doAsk(q);
                }}
                onRetry={() => void doAsk(lastAsk.current)}
              />
            )
          ) : showingFindResults ? (
            find.state === "loading" ? (
              <p className="status-line">Searching your library…</p>
            ) : find.state === "error" ? (
              <div className="error-box">
                <p>{find.message}</p>
                <button type="button" className="btn small" onClick={() => void doFind()}>
                  Try again
                </button>
              </div>
            ) : find.results.length === 0 ? (
              <div className="empty-state">
                <h2>Nothing in your library matches “{find.q}”.</h2>
                <p>Try different words, or clear the collection, tag and date filters.</p>
              </div>
            ) : (
              <>
                {!find.semantic ? (
                  <p className="semantic-note">
                    Meaning-based matching is off (no AI key); showing word matches.
                  </p>
                ) : null}
                <Rows
                  results={find.results}
                  q={find.q}
                  onOpen={(id) => openPanel({ kind: "detail", bookmarkId: id })}
                  onRetry={retryBookmark}
                />
              </>
            )
          ) : libState === "loading" ? (
            <SkeletonRows />
          ) : libState === "error" ? (
            <div className="error-box">
              <p>Your library could not be loaded.</p>
              <button
                type="button"
                className="btn small"
                onClick={() => void refreshBookmarks(filters)}
              >
                Try again
              </button>
            </div>
          ) : visibleBookmarks.length === 0 ? (
            <div className="empty-state">
              <h2>
                {bookmarks.length === 0 ? "Your library is empty" : "Nothing matches these filters"}
              </h2>
              <p>
                {bookmarks.length === 0
                  ? "Save a page or paste text to start building your library."
                  : "Clear a filter to see more of your library."}
              </p>
              {bookmarks.length === 0 ? (
                <button type="button" className="btn primary" onClick={() => setSaveOpen(true)}>
                  <Plus size={16} /> Save your first page
                </button>
              ) : null}
            </div>
          ) : (
            <Rows
              bookmarks={visibleBookmarks}
              onOpen={(id) => openPanel({ kind: "detail", bookmarkId: id })}
              onRetry={retryBookmark}
            />
          )}
        </main>

        {panel ? (
          <>
            <button
              type="button"
              className="panel-backdrop"
              aria-label="Close panel"
              tabIndex={-1}
              onClick={closePanel}
            />
            <Panel
            key={
              panel.kind === "source"
                ? `source-${panel.citation.passageId}`
                : `detail-${panel.bookmarkId}-${panel.focusPassageId ?? ""}`
            }
            state={panel}
            collections={collections}
            onClose={closePanel}
            onOpenDetail={(id, pid) => setPanel({ kind: "detail", bookmarkId: id, focusPassageId: pid })}
            onSaved={(b) => {
              setBookmarks((prev) => prev.map((x) => (x.id === b.id ? b : x)));
              void refreshMeta();
            }}
            onDeleted={(id) => {
              setBookmarks((prev) => prev.filter((x) => x.id !== id));
              setPanel(null);
              setAnnounce("Bookmark deleted.");
              void refreshMeta();
            }}
            onRetry={retryBookmark}
          />
          </>
        ) : null}
      </div>

      <SaveDialog
        open={saveOpen}
        collections={collections}
        onClose={() => setSaveOpen(false)}
        onSaved={(b) => {
          setSaveOpen(false);
          setBookmarks((prev) => [b, ...prev]);
          setAnnounce("Saved. Processing will finish shortly.");
          void refreshMeta();
        }}
        onOpenBookmark={(id) => {
          setSaveOpen(false);
          openPanel({ kind: "detail", bookmarkId: id });
        }}
      />

      <dialog
        ref={filtersDialogRef}
        aria-label="Filters"
        onClose={() => setFiltersOpen(false)}
        onCancel={() => setFiltersOpen(false)}
      >
        <div className="dialog-inner">{rail}</div>
      </dialog>

      <div aria-live="polite" className="visually-hidden">
        {announce}
      </div>
    </>
  );
}
