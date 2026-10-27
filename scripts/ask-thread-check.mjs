// Ask-thread UI check for Shelfmark. Usage:
//   npm run dev  (in another terminal)
//   node scripts/ask-thread-check.mjs [baseUrl]
// Verifies the Ask pending state, collapsible exchanges and Collapse all.
// The real model answer must come back — /api/ask is only delayed, not stubbed.
// Screenshots -> .data/evidence/screens/. Exits non-zero on any FAIL.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = path.resolve(".data/evidence/screens");
const EMAIL = `thread-${Date.now()}@test.dev`;
const PASSWORD = "thread-check-pass-123";

const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
}

async function probe(fn) {
  try {
    return await fn();
  } catch {
    return false;
  }
}

async function api(pathname, { method = "GET", body, cookie } = {}) {
  return fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function sessionCookie(res) {
  const raw = res.headers.get("set-cookie") ?? "";
  const match = /session=([^;]+)/.exec(raw);
  if (!match) throw new Error("signup did not set a session cookie");
  return `session=${match[1]}`;
}

async function seed(cookie) {
  const res = await api("/api/bookmarks", {
    method: "POST",
    cookie,
    body: {
      title: "Bread fermentation notes",
      text: [
        "Sourdough bulk fermentation is the first rise after mixing, and its length depends mostly on dough temperature and starter activity. At a warm 26-28°C, bulk fermentation typically takes 3 to 4 hours. In a cooler kitchen around 21°C, expect 5 to 7 hours, and cold doughs can need 8 hours or more.",
        "Look for signs rather than the clock: the dough should grow by about 30-50%, feel airy and slightly domed, and show bubbles along the sides of the container. Under-fermented dough feels dense and tight; over-fermented dough is slack, sticky, and smells sharply sour.",
        "Many bakers use coil folds or stretch-and-folds every 30-45 minutes during the first half of bulk to build strength. If your kitchen is cold, keep the dough in a slightly warm oven with the light on to hold the dough around 24-26°C.",
      ].join("\n\n"),
    },
  }).then((r) => r.json());
  const id = res.bookmark.id;

  for (let i = 0; i < 90; i++) {
    const one = await api(`/api/bookmarks/${id}`, { cookie }).then((r) => r.json());
    if (one.bookmark.status === "ready") return id;
    if (one.bookmark.status === "failed") throw new Error(`bookmark failed: ${one.bookmark.error}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("bookmark did not become ready in time");
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`saved ${name}.png`);
}

async function waitForAnswer(page, index) {
  // Wait until the exchange body holds a real outcome (answer, insufficient,
  // unavailable passages or an error box).
  await page
    .locator(".exchange")
    .nth(index)
    .locator(".answer-segments, .insufficient, .matched-passages, .error-box")
    .first()
    .waitFor({ state: "visible", timeout: 90_000 });
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const signup = await api("/api/auth/signup", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  if (!signup.ok) throw new Error(`signup failed: HTTP ${signup.status}`);
  const cookie = sessionCookie(signup);
  await seed(cookie);
  console.log(`seeded user ${EMAIL} with 1 ready bookmark`);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([
      { name: "session", value: cookie.split("=")[1], url: BASE },
    ]);
    const page = await context.newPage();

    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".rows .row-title", { timeout: 60_000 });
    await page.locator(".mode-switch label", { hasText: "Ask" }).click();

    // Delay /api/ask by ~1.5 s so the pending state is reliably observable;
    // route.continue() still delivers the real model answer.
    await page.route("**/api/ask", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });

    await page.fill(".search-input", "How long should bulk fermentation take?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();

    const asking = page.getByRole("button", { name: "Asking…", exact: true });
    check(
      "submit label switches to “Asking…” while in flight",
      await probe(async () => {
        await asking.waitFor({ state: "visible", timeout: 5000 });
        return true;
      }),
    );
    check("submit disabled while in flight", await asking.isDisabled());
    check(
      "submit aria-busy while in flight",
      (await asking.getAttribute("aria-busy")) === "true",
    );
    check(
      ".answer-pending status line visible while in flight",
      await page.locator(".answer-pending").isVisible(),
    );
    await shot(page, "ask-pending-desktop");

    await probe(() => waitForAnswer(page, 0));
    await page.unroute("**/api/ask");
    check("first ask resolved", await page.locator(".answer-pending").count() === 0);

    await page.fill(".search-input", "What temperature is recommended?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await probe(() => waitForAnswer(page, 1));

    const exchanges = page.locator(".exchange");
    const toggles = page.locator(".exchange-toggle");
    check("thread has two exchanges", (await exchanges.count()) === 2);
    check(
      "first exchange collapsed by default",
      (await toggles.nth(0).getAttribute("aria-expanded")) === "false",
    );
    const meta = await exchanges.nth(0).locator(".exchange-meta").textContent();
    check(
      "first exchange meta shows a status",
      /Answered|Insufficient/.test(meta ?? ""),
      `meta=${(meta ?? "").trim()}`,
    );
    check(
      "second exchange open by default",
      (await toggles.nth(1).getAttribute("aria-expanded")) === "true",
    );
    await shot(page, "ask-thread-desktop");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await shot(page, "ask-thread-mobile");
    await page.setViewportSize({ width: 1440, height: 900 });

    await toggles.nth(0).click();
    check(
      "click expands first exchange",
      (await toggles.nth(0).getAttribute("aria-expanded")) === "true",
    );
    await toggles.nth(0).press("Enter");
    check(
      "Enter collapses first exchange",
      (await toggles.nth(0).getAttribute("aria-expanded")) === "false",
    );

    await page.getByRole("button", { name: "Collapse all", exact: true }).click();
    check(
      "Collapse all: first collapsed",
      (await toggles.nth(0).getAttribute("aria-expanded")) === "false",
    );
    check(
      "Collapse all: second collapsed",
      (await toggles.nth(1).getAttribute("aria-expanded")) === "false",
    );

    await context.close();
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`${failed === 0 ? "PASS" : "FAIL"} summary: ${failed} failed check(s)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
