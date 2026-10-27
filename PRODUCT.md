# Shelfmark

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js 16 (App Router, Route Handlers) with TypeScript, PostgreSQL with pgvector (embedded PGlite locally, any pgvector Postgres in production), Vercel AI SDK, Google Gemini by default (Vercel AI Gateway as an alternative). See `docs/ARCHITECTURE.md`.

## Product purpose

A personal research library. People save public web pages or pasted text, find them again with vague words ("that free course I saved"), and ask questions answered only from what they saved, with every claim linked to the exact passage behind it.

Inspired by Karakeep's bookmarking experience. Retrieval-augmented answers are the core feature, not an add-on.

## Audience

- Self-directed learners comparing courses, certifications, and tutorials they have collected.
- Researchers, students, and engineers who save many articles and later need to recall, compare, or reconcile them.
- People who don't trust AI answers unless they can check the source themselves.

## User journeys

1. **Save:** paste a URL (or text) → the bookmark appears as *pending* → *processing* → *ready*. If extraction fails, the row shows why and offers Retry or Paste text.
2. **Find:** type a few words in Find mode → ranked bookmarks with the matching excerpt, filterable by tag, collection, and saved date → open one to read the captured text and the original link.
3. **Ask:** switch to Ask, type a question (optionally scoped to a collection) → an answer split into sourced facts, suggestions, and interpretation; conflicts and missing information called out → click a citation to see the exact passage highlighted → ask a suggested follow-up.
4. **Organize:** edit title, note, tags, and collection; delete a bookmark, after which it no longer appears in Find or Ask.

## MVP scope

- Email/password accounts; each user sees only their own data.
- Save public text web pages and pasted text; duplicate detection; background processing with retries.
- Hybrid keyword + semantic Find; cited Ask with conversation history.
- Collections, tags, saved-date filters; edit, delete, retry.
- "Insufficient data to verify" when the saved material can't support an answer.

## Deferred (not built)

- Browser extension, mobile share sheet, bulk import (Pocket/Karakeep/HTML bookmarks).
- Authenticated or social-media sources, PDFs, images/OCR, video or audio transcription.
- Autonomous browsing or live web verification of saved claims.
- Streaming answers, shared collections, multi-user workspaces, OAuth sign-in, password reset email.
- Durable job queue (Vercel Queues/Workflow) for multi-instance processing.

## Capabilities and constraints

- Never fetch private-network or metadata addresses; never bypass logins or paywalls.
- Answers treat saved text as evidence, never as instructions.
- Saved prices, dates, and requirements are shown as of their capture date, not as current facts.
- No fabricated or sample data presented as the user's content.
