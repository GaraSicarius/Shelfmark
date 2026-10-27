import assert from "node:assert/strict";
import { test } from "node:test";
import { pages, readPage } from "./navigation.ts";

test("all five pages resolve; empty and invalid routes return to login", () => {
  for (const page of pages) assert.equal(readPage(`#/${page}`), page);
  for (const hash of [
    "",
    "#/",
    "#/unknown",
    "#/feature-4",
    "#/dashboard/extra",
  ]) {
    assert.equal(readPage(hash), "login");
  }
});
