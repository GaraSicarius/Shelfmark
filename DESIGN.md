# Shelfmark: design

A shelfmark is the mark that tells a reader where a book lives in a library. The app is a personal reading room: you save pages, find them again, and ask questions answered only from what you saved. Mode: **Operate**, a tool for daily use that should be fast to scan and calm to read.

## Point of view

Evidence comes first. Every answer is visibly tied to the passage that supports it, and the one memorable gesture is the **highlighter**: citation markers are small highlighter-yellow tabs, and opening one sweeps the same highlight across the exact supporting passage. Everything else stays quiet: rows instead of cards, hairline dividers that separate content, and no decorative gradients or shadows.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#F1F3EF` | App background (cool sage paper) |
| `--surface` | `#FFFFFF` | Panels, dialogs, inputs |
| `--ink` | `#18232A` | Primary text (≥ 13:1 on paper) |
| `--ink-muted` | `#55636B` | Secondary text, domains, dates (≥ 5.5:1) |
| `--rule` | `#D5DBD6` | Dividers, input borders |
| `--action` | `#1D5C6E` | Primary buttons, links, focus ring, active mode |
| `--action-hover` | `#164A59` | Hover/pressed |
| `--mark` | `#F3DD6B` | Highlighter: citation tabs, highlighted passage |
| `--mark-strong` | `#E5C640` | Citation tab hover/active |
| `--ready` | `#2F7A4F` | Status ready |
| `--processing` | `#2C5FA8` | Status processing |
| `--pending` | `#6B7780` | Status pending |
| `--failed` | `#A63A2B` | Status failed, destructive actions |
| `--conflict` | `#9A5410` | Conflicting-sources block |

Status never relies on color alone: each status shows a text label next to its color dot.

**Type**
- UI: **Public Sans** (variable), sizes 13 / 14 / 16 / 18 / 22 / 28 px, weights 400/500/650.
- Reading text (captured content, passages, answer prose): **Source Serif 4**, 17 px, line-height 1.6, max width 68ch.
- Sentence case everywhere. No all-caps labels, no monospace labels, no eyebrow labels.

**Shape and space**
- 4 px grid. Radii: 6 px controls, 10 px panels and dialogs, 999 px only for citation tabs and status dots.
- Focus: 2 px `--action` outline with a 2 px offset on every interactive element (`:focus-visible`).

## Structure

```
Desktop ≥ 1100px
┌──────────────────────────────────────────────────────────────────────┐
│ Shelfmark                                     [+ Save]   user@… ▾     │
├────────────┬────────────────────────────────────────┬────────────────┤
│ Library    │ (Find | Ask)  [ search or question… ] │ Detail / source│
│ All        │                                        │ panel (440px)  │
│ Failed (2) │  Results list  OR  Answer view         │ opens on demand│
│ Collections│                                        │                │
│ Tags       │                                        │                │
│ Saved date │                                        │                │
└────────────┴────────────────────────────────────────┴────────────────┘
Tablet 700–1099: rail collapses into a "Filters" button (dialog); panel overlays the right side.
Mobile < 700: single column; filters and detail/source open as full-screen dialogs.
```

- **Library row:** title (link-styled button), domain, tags, saved date, status label. Failed rows show the error and a Retry button inline. Pending/processing rows show progress text, not a spinner wall.
- **Find results:** the same row, plus a relevant excerpt with matched words in `<mark>` and a "keyword / meaning / both" match note.
- **Answer view:** the question as heading, then segments:
  - Facts in serif prose with citation tabs `[1]`.
  - "Suggested from your sources" (suggestions) and "Interpretation" blocks, each with a plain-text label and set apart by a 1 px `--rule` left rule and indentation (never a thick colored bar).
  - "Not directly sourced" label on any uncited segment.
  - "Sources disagree" block in `--conflict` that lists each side with its citations.
  - "Not found in your sources" list for gaps.
  - Footer: "Based on pages saved between {date} and {date}. Prices, dates and requirements may have changed since." Then follow-up question buttons.
- **Insufficient evidence:** the heading "Insufficient data to verify", one line on why, and next steps (rephrase, widen the collection filter, save a source).
- **Source panel:** title, domain, saved date, "Open original" link; the cited passage highlighted in the context of neighbouring passages; "Open full capture" switches to the detail view.
- **Detail view:** editable title, note, collection, and tags; captured text in serif; actions to delete (with confirmation) and to retry or paste text when processing failed.

## Interaction rules

- `/` focuses the search field (unless typing in an input). The mode switch is a radio group: arrow keys move between Find and Ask, and the active mode sets the placeholder and button label ("Find" or "Ask").
- Enter submits. In Ask mode a follow-up button submits immediately into the same conversation.
- While a request runs, the submit button is disabled and shows a spinner with "Finding…" or "Asking…". A new Ask clears the input, appends the question to the thread with an inline "Searching your saved sources and writing an answer…" status, and scrolls it into view.
- Ask exchanges collapse. Only the newest is open by default; older ones shrink to one line (question plus status, e.g. "Answered · 3 sources"). Each header is a button with `aria-expanded`. "Collapse all"/"Expand all" appears once there are two or more exchanges. Manual toggles reset when a new question is asked.
- Opening the panel moves focus to its heading. `Esc` closes it and returns focus to the trigger. Dialogs use native `<dialog>` with `showModal()`.
- While any bookmark is `pending` or `processing`, the library refreshes every 2 s and stops when none remain.
- Motion: only the highlighter sweep (`background-size` 0→100%, 450 ms ease-out) and panel slide (160 ms). Both are disabled under `prefers-reduced-motion`.
- Every async view has loading (skeleton rows or "Searching your library…"), empty, error (states what failed and how to fix it, with a retry), and success states.
- Real data only: empty states invite the user to save a page and never show sample bookmarks.
