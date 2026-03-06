import { describe, it, expect } from "vitest";
import { calculateBackoff, shouldRetry } from "../src/orchestrator.js";

describe("calculateBackoff", () => {
  it("returns 10s for first attempt", () => {
    expect(calculateBackoff(1)).toBe(10_000);
  });

  it("doubles each attempt", () => {
    expect(calculateBackoff(2)).toBe(20_000);
    expect(calculateBackoff(3)).toBe(40_000);
  });

  it("caps at 5 minutes", () => {
    expect(calculateBackoff(10)).toBe(300_000);
  });
});

describe("shouldRetry", () => {
  it("returns true when nextRetryAt is in the past", () => {
    const entry = { nextRetryAt: new Date(Date.now() - 1000) } as any;
    expect(shouldRetry(entry)).toBe(true);
  });

  it("returns false when nextRetryAt is in the future", () => {
    const entry = { nextRetryAt: new Date(Date.now() + 60_000) } as any;
    expect(shouldRetry(entry)).toBe(false);
  });
});
