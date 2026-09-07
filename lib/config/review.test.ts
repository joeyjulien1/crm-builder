import { describe, expect, it } from "vitest";
import { needsConfirmation } from "./review";
import type { ImpactItem } from "./types";

const item = (over: Partial<ImpactItem> = {}): ImpactItem => ({
  description: "Does a thing",
  destructive: false,
  externalEffect: false,
  ...over,
});

const summary = (items: ImpactItem[]) => ({
  items,
  hasDestructive: items.some((entry) => entry.destructive),
  hasExternalEffects: items.some((entry) => entry.externalEffect),
});

describe("what is worth stopping the user for", () => {
  it("lets an additive change through without interrupting the builder", () => {
    expect(needsConfirmation(summary([item()]))).toBe(false);
  });

  it("lets a destructive change through when there is nothing to lose", () => {
    // Deleting a view nobody has looked at, or a field no record has held.
    // Confirming this is a step, not a safeguard.
    expect(needsConfirmation(summary([item({ destructive: true, affectedRecords: 0 })]))).toBe(false);
    expect(needsConfirmation(summary([item({ destructive: true })]))).toBe(false);
  });

  it("stops when a destructive change would drop real values", () => {
    expect(needsConfirmation(summary([item({ destructive: true, affectedRecords: 412 })]))).toBe(true);
  });

  it("always stops for anything that leaves the building", () => {
    // A sent email cannot be taken back by a rollback.
    expect(needsConfirmation(summary([item({ externalEffect: true })]))).toBe(true);
  });

  it("stops when it does not know what the change would do", () => {
    expect(needsConfirmation()).toBe(true);
  });

  it("stops for the one bad item in an otherwise harmless set", () => {
    expect(
      needsConfirmation(summary([item(), item({ destructive: true, affectedRecords: 3 }), item()])),
    ).toBe(true);
  });
});
