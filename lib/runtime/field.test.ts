import { describe, expect, it } from "vitest";
import type { FieldConfig } from "@/lib/config/types";
import { coerceValue, formatValue, validateValue } from "./field";

const field = (overrides: Partial<FieldConfig> & Pick<FieldConfig, "type">): FieldConfig => ({
  id: "fld_x",
  key: "x",
  label: "Amount",
  required: false,
  system: false,
  ...overrides,
});

describe("formatValue", () => {
  it("formats currency with the field's currency code", () => {
    expect(formatValue(field({ type: "currency", currencyCode: "USD" }), 50000)).toBe("$50,000");
    expect(formatValue(field({ type: "currency", currencyCode: "EUR" }), 1200)).toBe("€1,200");
  });

  it("formats a select through its option label", () => {
    const stage = field({
      type: "select",
      options: [{ value: "proposal", label: "Proposal" }],
    });
    expect(formatValue(stage, "proposal")).toBe("Proposal");
    // A value whose option was removed still renders as itself, not as blank.
    expect(formatValue(stage, "retired")).toBe("retired");
  });

  it("formats a multi_select as a readable list", () => {
    const tags = field({
      type: "multi_select",
      options: [
        { value: "vip", label: "VIP" },
        { value: "churn_risk", label: "Churn risk" },
      ],
    });
    expect(formatValue(tags, ["vip", "churn_risk"])).toBe("VIP, Churn risk");
  });

  it("renders empty values as empty, not as 'null'", () => {
    expect(formatValue(field({ type: "text" }), null)).toBe("");
    expect(formatValue(field({ type: "number" }), undefined)).toBe("");
    expect(formatValue(field({ type: "date" }), "not a date")).toBe("");
  });

  it("shows a relation as its label when one is available", () => {
    const company = field({ type: "relation", relationKey: "company_contacts" });
    expect(formatValue(company, "abc", { labelFor: () => "Acme Corp" })).toBe("Acme Corp");
    expect(formatValue(company, "abc")).toBe("abc");
  });

  it("shows a boolean as Yes or No", () => {
    expect(formatValue(field({ type: "boolean" }), true)).toBe("Yes");
    expect(formatValue(field({ type: "boolean" }), false)).toBe("No");
  });
});

describe("coerceValue", () => {
  it("pulls a number out of a formatted string", () => {
    expect(coerceValue(field({ type: "currency" }), "$50,000")).toBe(50000);
    expect(coerceValue(field({ type: "number" }), "42")).toBe(42);
    expect(coerceValue(field({ type: "number" }), "not a number")).toBeNull();
  });

  it("accepts the words a spreadsheet uses for booleans", () => {
    expect(coerceValue(field({ type: "boolean" }), "Yes")).toBe(true);
    expect(coerceValue(field({ type: "boolean" }), "FALSE")).toBe(false);
    expect(coerceValue(field({ type: "boolean" }), "maybe")).toBeNull();
  });

  it("normalises dates to ISO", () => {
    expect(coerceValue(field({ type: "date" }), "2026-03-15T10:00:00Z")).toBe("2026-03-15");
    expect(coerceValue(field({ type: "datetime" }), "2026-03-15T10:00:00Z")).toBe("2026-03-15T10:00:00.000Z");
  });

  it("matches a select by value or by label", () => {
    const stage = field({
      type: "select",
      options: [{ value: "proposal", label: "Proposal" }],
    });
    expect(coerceValue(stage, "proposal")).toBe("proposal");
    expect(coerceValue(stage, "Proposal")).toBe("proposal");
    expect(coerceValue(stage, "Nonsense")).toBeNull();
  });

  it("splits a multi_select and drops values that are not options", () => {
    const tags = field({
      type: "multi_select",
      options: [
        { value: "vip", label: "VIP" },
        { value: "newsletter", label: "Newsletter" },
      ],
    });
    expect(coerceValue(tags, "VIP, Newsletter, Nonsense")).toEqual(["vip", "newsletter"]);
  });

  it("lowercases an email so matching against mail works", () => {
    expect(coerceValue(field({ type: "email" }), " Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("treats blank as no value", () => {
    expect(coerceValue(field({ type: "text" }), "   ")).toBeNull();
  });
});

describe("validateValue", () => {
  it("says what to enter rather than that something is invalid", () => {
    expect(validateValue(field({ type: "email" }), "nope")).toBe(
      "Enter an email address, like name@company.com",
    );
    expect(validateValue(field({ type: "url" }), "example.com")).toBe(
      "Enter a link starting with http:// or https://",
    );
  });

  it("requires a value only when the field is required", () => {
    expect(validateValue(field({ type: "text", required: true, label: "Name" }), "")).toBe("Enter a name");
    expect(validateValue(field({ type: "text" }), "")).toBeNull();
  });

  it("accepts a valid value of each awkward type", () => {
    expect(validateValue(field({ type: "email" }), "ada@example.com")).toBeNull();
    expect(validateValue(field({ type: "phone" }), "+44 20 7123 4567")).toBeNull();
    expect(validateValue(field({ type: "url" }), "https://example.com")).toBeNull();
  });
});
