import { describe, expect, it } from "vitest";
import { filterParams, isDateString } from "@/lib/validate";

const is400 = (r: unknown) => r instanceof Response && r.status === 400;

describe("isDateString", () => {
  it.each(["2026-10-20", "2000-02-29"])("accepts %s", (v) => {
    expect(isDateString(v)).toBe(true);
  });

  it.each([
    "20-10-2026",
    "2026-13-01",
    "2026-02-30", // not a real calendar date
    "2023-02-29", // not a leap year
    "2026-1-5",
    "garbage",
    "2026-10-20T00:00:00Z",
  ])("rejects %s", (v) => {
    expect(isDateString(v)).toBe(false);
  });
});

describe("filterParams", () => {
  it("returns nulls when no filters are given", () => {
    const f = filterParams(new URLSearchParams());
    expect(f).toEqual({ collectionId: null, tag: null, from: null, to: null, status: null });
  });

  it("passes valid filters through", () => {
    const f = filterParams(
      new URLSearchParams({ from: "2026-01-01", to: "2026-12-31", status: "ready" }),
    );
    expect(f.from).toBe("2026-01-01");
    expect(f.to).toBe("2026-12-31");
    expect(f.status).toBe("ready");
  });

  it.each(["from", "to"])("rejects a bad %s date with 400", (key) => {
    try {
      filterParams(new URLSearchParams({ [key]: "not-a-date" }));
      expect.unreachable();
    } catch (err) {
      expect(is400(err)).toBe(true);
    }
  });

  it("rejects an unknown status with 400", () => {
    try {
      filterParams(new URLSearchParams({ status: "archived" }));
      expect.unreachable();
    } catch (err) {
      expect(is400(err)).toBe(true);
    }
  });
});
