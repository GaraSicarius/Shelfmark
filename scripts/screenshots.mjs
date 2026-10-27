// Screenshot run for Shelfmark. Usage:
//   npm run dev  (in another terminal)
//   node scripts/screenshots.mjs [baseUrl]
// Writes PNGs to .data/evidence/screens/.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = path.resolve(".data/evidence/screens");
const EMAIL = `shots-${Date.now()}@test.dev`;
const PASSWORD = "screenshot-pass-123";

async function api(pathname, { method = "GET", body, cookie } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

function sessionCookie(res) {
  const raw = res.headers.get("set-cookie") ?? "";
  const match = /session=([^;]+)/.exec(raw);
  if (!match) throw new Error("signup did not set a session cookie");
  return `session=${match[1]}`;
}

async function seed(cookie) {
  const col = await api("/api/collections", {
    method: "POST",
    cookie,
    body: { name: "Test collection: courses" },
  }).then((r) => r.json());
  const collectionId = col.collection.id;

  const docs = [
    {
      title: "Test note: AWS certification course",
      text: "A free, self-paced course covering the AWS certification exam. It covers exam domains, practice questions, and study plans. The course includes four modules with a short quiz at the end of each one. ".repeat(8),
      tags: ["aws", "course"],
    },
    {
      title: "Test note: Sourdough starter guide",
      text: "A beginner's guide to sourdough starter: feed daily with equal weights of flour and water, keep at room temperature for a week, then refrigerate. Discard half before each feeding. ".repeat(8),
      tags: ["baking"],
    },
    {
      title: "Test note: Lisbon itinerary",
      text: "A three-day Lisbon itinerary: Alfama and the castle on day one, Belem for the monastery and pastries on day two, and a day trip to Sintra for the palaces on day three. ".repeat(8),
      tags: ["travel"],
    },
  ];

  const ids = [];
  for (const d of docs) {
    const res = await api("/api/bookmarks", {
      method: "POST",
      cookie,
      body: { ...d, collectionId },
    }).then((r) => r.json());
    ids.push(res.bookmark.id);
  }

  for (let i = 0; i < 60; i++) {
    const list = await api("/api/bookmarks", { cookie }).then((r) => r.json());
    if (list.bookmarks.every((b) => b.status === "ready" || b.status === "failed")) {
      const failed = list.bookmarks.filter((b) => b.status === "failed");
      if (failed.length) throw new Error(`bookmarks failed: ${failed[0].error}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("bookmarks did not become ready in time");
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`saved ${name}.png`);
}

async function capture(browser, { width, height, prefix, cookieValue }) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addCookies([{ name: "session", value: cookieValue, url: BASE }]);
  const page = await context.newPage();

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".rows .row-title", { timeout: 60_000 });
  await shot(page, `${prefix}-library`);

  // Find results for "course".
  await page.fill(".search-input", "course");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.waitForSelector(".row-excerpt", { timeout: 30_000 });
  await shot(page, `${prefix}-find`);

  // Ask with an unrelated question -> insufficient state.
  await page.locator(".mode-switch label", { hasText: "Ask" }).click();
  await page.fill(".search-input", "What do my sources say about quantum computing?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.waitForSelector(".insufficient h2", { timeout: 60_000 });
  await shot(page, `${prefix}-ask-insufficient`);

  // Ask with a related question -> 503 ai_unavailable (no AI key configured).
  await page.fill(".search-input", "Is the AWS course free?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.waitForSelector(".matched-passages", { timeout: 60_000 });
  await shot(page, `${prefix}-ask-unavailable`);

  // Open a source panel from a matched passage; give the 0.45 s highlight
  // sweep time to finish before the shot.
  await page.locator(".matched-passages .row-title").first().click();
  await page.waitForSelector(".panel .passage", { timeout: 30_000 });
  await page.waitForTimeout(600);
  await shot(page, `${prefix}-source-panel`);
  // The panel is full-screen on mobile — close it before driving the page.
  await page.locator(".panel").getByRole("button", { name: "Close panel" }).click();

  // Answered-state render check. This verifies UI rendering only, NOT model
  // output: POST /api/ask is intercepted and answered with a stub built from
  // the real citations the server's 503 returned, and every stub string is
  // prefixed "Test answer:" so it can never be mistaken for model output.
  const realAsk = await api("/api/ask", {
    method: "POST",
    cookie: `session=${cookieValue}`,
    body: { question: "Is the AWS course free?" },
  });
  const realBody = await realAsk.json();
  const citations = realBody.details?.citations ?? [];
  if (citations.length === 0) {
    throw new Error("expected 503 citations from the real ask to stub against");
  }
  const stubAnswer = {
    conversationId: "stub",
    messageId: "stub",
    answer: {
      status: "answered",
      segments: [
        {
          kind: "fact",
          text: "Test answer: the AWS course is free and self-paced.",
          citations: [1],
        },
        {
          kind: "suggestion",
          text: "Test answer: work through the practice questions first.",
          citations: citations.length > 1 ? [1, 2] : [1],
        },
        {
          kind: "interpretation",
          text: "Test answer: this looks like solid exam prep material.",
          citations: [],
          uncited: true,
        },
      ],
      conflicts: [
        {
          description: "Test answer: sources disagree on how deep the quizzes go.",
          citations: [1],
        },
      ],
      gaps: ["Test answer: what the certificate costs is not stated."],
      followUps: [
        "Test answer: what modules does it include?",
        "Test answer: how long does it take?",
      ],
      citations,
      retrieval: { semantic: false, passages: citations.length },
    },
  };
  await page.route("**/api/ask", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(stubAnswer),
    }),
  );
  await page.fill(".search-input", "Test answer: is the course worth taking?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.waitForSelector(".answer-segments .segment.fact", { timeout: 30_000 });
  await shot(page, `${prefix}-ask-answered`);

  // Citation tab [1] opens the source panel on the highlighted passage.
  await page.locator(".cite").first().click();
  await page.waitForSelector(".panel .passage", { timeout: 30_000 });
  await page.waitForTimeout(600);
  await shot(page, `${prefix}-answer-citation`);
  await page.unroute("**/api/ask");

  // Detail panel for the first bookmark (close the source panel first — it
  // covers the whole viewport on mobile).
  await page.locator(".panel").getByRole("button", { name: "Close panel" }).click();
  await page.locator(".mode-switch label", { hasText: "Find" }).click();
  await page.fill(".search-input", "");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.waitForSelector(".rows .row-title", { timeout: 30_000 });
  await page.locator(".rows .row-title").first().click();
  await page.waitForSelector(".panel .detail-form", { timeout: 30_000 });
  await shot(page, `${prefix}-detail-panel`);

  // Save dialog (close the panel first — it covers the header on mobile).
  await page.locator(".panel").getByRole("button", { name: "Close panel" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForSelector("dialog[open] .dialog-inner", { timeout: 15_000 });
  await shot(page, `${prefix}-save-dialog`);

  await context.close();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const signup = await api("/api/auth/signup", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  if (!signup.ok) throw new Error(`signup failed: HTTP ${signup.status}`);
  const cookie = sessionCookie(signup);
  const cookieValue = cookie.split("=")[1];
  await seed(cookie);
  console.log(`seeded user ${EMAIL} with 3 ready bookmarks`);

  const browser = await chromium.launch();
  try {
    // Login page (unauthenticated, desktop viewport).
    const loginContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const loginPage = await loginContext.newPage();
    await loginPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await loginPage.waitForSelector(".login-card", { timeout: 60_000 });
    await shot(loginPage, "desktop-login");
    await loginContext.close();

    const mobileLogin = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobileLoginPage = await mobileLogin.newPage();
    await mobileLoginPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await mobileLoginPage.waitForSelector(".login-card", { timeout: 60_000 });
    await shot(mobileLoginPage, "mobile-login");
    await mobileLogin.close();

    await capture(browser, { width: 1440, height: 900, prefix: "desktop", cookieValue });
    await capture(browser, { width: 390, height: 844, prefix: "mobile", cookieValue });
  } finally {
    await browser.close();
  }
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
