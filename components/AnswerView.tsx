"use client";

import { ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Answer, Citation } from "./api";
import type { Exchange } from "./types";
import { formatDate } from "./util";

function CiteTabs({
  numbers,
  citations,
  onCitation,
}: {
  numbers: number[];
  citations: Citation[];
  onCitation: (c: Citation) => void;
}) {
  return (
    <>
      {numbers.map((n) => {
        const c = citations.find((x) => x.n === n);
        if (!c) return null;
        return (
          <button
            key={n}
            type="button"
            className="cite"
            aria-label={`Source ${n}: ${c.title ?? "deleted source"}`}
            onClick={() => onCitation(c)}
          >
            {n}
          </button>
        );
      })}
    </>
  );
}

const SEGMENT_LABEL: Record<string, string | null> = {
  fact: null,
  suggestion: "Suggested from your sources",
  interpretation: "Interpretation",
};

function AnswerBody({
  answer,
  onCitation,
  onFollowUp,
}: {
  answer: Answer;
  onCitation: (c: Citation) => void;
  onFollowUp: (q: string) => void;
}) {
  if (answer.status === "insufficient") {
    const reason =
      answer.segments.find((s) => s.text)?.text ?? "Your saved pages do not cover this question.";
    return (
      <div className="insufficient">
        <h2>Insufficient data to verify</h2>
        <p>{reason.replace(/^Insufficient data to verify\.?\s*/, "") || "No saved passages matched your question."}</p>
        <ul>
          <li>Rephrase the question using words from the pages you saved.</li>
          <li>Widen the collection filter, or ask across the whole library.</li>
          <li>Save a page or pasted text that covers this topic.</li>
        </ul>
      </div>
    );
  }

  const dates = answer.citations
    .map((c) => c.capturedAt)
    .filter((d): d is string => Boolean(d))
    .sort();
  const earliest = dates[0];
  const latest = dates[dates.length - 1];

  return (
    <div>
      <div className="answer-segments">
        {answer.segments.map((s, i) => (
          <div className={`segment ${s.kind}`} key={i}>
            {SEGMENT_LABEL[s.kind] ? (
              <span className="segment-label">{SEGMENT_LABEL[s.kind]}</span>
            ) : null}
            <span>
              {s.text}
              <CiteTabs numbers={s.citations} citations={answer.citations} onCitation={onCitation} />
            </span>
            {s.uncited ? <span className="uncited-note">Not directly sourced</span> : null}
          </div>
        ))}
      </div>

      {answer.conflicts.length > 0 ? (
        <div className="conflict-block">
          <h3>Sources disagree</h3>
          <ul>
            {answer.conflicts.map((c, i) => (
              <li key={i}>
                {c.description}
                <CiteTabs numbers={c.citations} citations={answer.citations} onCitation={onCitation} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {answer.gaps.length > 0 ? (
        <div className="gaps-block">
          <h3>Not found in your sources</h3>
          <ul>
            {answer.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {earliest ? (
        <p className="answer-footer">
          Based on pages saved between {formatDate(earliest)} and {formatDate(latest)}. Prices,
          dates and requirements may have changed since.
        </p>
      ) : null}

      {answer.followUps.length > 0 ? (
        <div className="follow-ups">
          {answer.followUps.map((q, i) => (
            <button key={i} type="button" className="follow-up" onClick={() => onFollowUp(q)}>
              {q}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function exchangeMeta(ex: Exchange): string {
  if (ex.answer) {
    if (ex.answer.status === "insufficient") return "Insufficient data to verify";
    const n = ex.answer.citations.length;
    return `Answered · ${n} source${n === 1 ? "" : "s"}`;
  }
  if (ex.unavailable) return "Answer unavailable";
  if (ex.failed) return "Failed";
  return "Generating…";
}

export default function AnswerView({
  exchanges,
  onCitation,
  onFollowUp,
  onRetry,
}: {
  exchanges: Exchange[];
  onCitation: (c: Citation) => void;
  onFollowUp: (q: string) => void;
  onRetry: () => void;
}) {
  // User toggles are remembered only until a new exchange is appended, at
  // which point the default (last one open) applies again.
  const [ov, setOv] = useState<{ last: string; map: Record<string, boolean> }>({
    last: "",
    map: {},
  });
  const lastRef = useRef<HTMLElement | null>(null);
  const lastId = exchanges[exchanges.length - 1]?.id ?? "";
  const map = ov.last === lastId ? ov.map : {};
  const isOpen = (ex: Exchange, i: number) => map[ex.id] ?? i === exchanges.length - 1;
  const anyOpen = exchanges.some((ex, i) => isOpen(ex, i));

  useEffect(() => {
    if (!lastId || !lastRef.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    lastRef.current.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [lastId]);

  function setAll(open: boolean) {
    setOv({
      last: lastId,
      map: Object.fromEntries(exchanges.map((e) => [e.id, open])),
    });
  }

  return (
    <div className="thread">
      {exchanges.length >= 2 ? (
        <div className="thread-tools">
          <button type="button" className="btn small" onClick={() => setAll(!anyOpen)}>
            {anyOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      ) : null}
      {exchanges.map((ex, i) => {
        const open = isOpen(ex, i);
        const bodyId = `exchange-body-${ex.id}`;
        return (
          <section
            className={`exchange${open ? "" : " collapsed"}`}
            key={ex.id}
            ref={i === exchanges.length - 1 ? lastRef : undefined}
          >
            <h2 className="question">
              <button
                type="button"
                className="exchange-toggle"
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={() =>
                  setOv({ last: lastId, map: { ...map, [ex.id]: !open } })
                }
              >
                <ChevronRight className="exchange-chevron" size={16} aria-hidden="true" />
                <span className="exchange-q">{ex.question}</span>
                {open ? null : <span className="exchange-meta">{exchangeMeta(ex)}</span>}
              </button>
            </h2>
            {open ? (
              <div id={bodyId} className="exchange-body">
                {ex.answer ? (
                  <AnswerBody answer={ex.answer} onCitation={onCitation} onFollowUp={onFollowUp} />
                ) : null}
                {ex.unavailable ? (
                  <div>
                    <p>{ex.unavailable.message}</p>
                    {ex.unavailable.citations.length > 0 ? (
                      <div className="matched-passages">
                        <h3>Passages that matched</h3>
                        <ul className="rows">
                          {ex.unavailable.citations.map((c) => (
                            <li className="row" key={c.passageId}>
                              <div className="row-top">
                                <button
                                  type="button"
                                  className="row-title"
                                  onClick={() => onCitation(c)}
                                >
                                  {c.title ?? "Source"}
                                </button>
                                <span className="row-domain">{c.domain ?? "Pasted text"}</span>
                                <span className="row-date">{formatDate(c.capturedAt)}</span>
                              </div>
                              <p className="row-excerpt">{c.quote}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {ex.failed ? (
                  <div className="error-box">
                    <p>{ex.failed.message}</p>
                    <button type="button" className="btn small" onClick={onRetry}>
                      Try again
                    </button>
                  </div>
                ) : null}
                {!ex.answer && !ex.unavailable && !ex.failed ? (
                  <p className="answer-pending" role="status">
                    <Loader2 className="spin" size={16} aria-hidden="true" /> Searching your
                    saved sources and writing an answer…
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
