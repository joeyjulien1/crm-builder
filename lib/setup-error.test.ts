import { describe, expect, it } from "vitest";
import { describeSetupFailure } from "./setup-error";

describe("describing a setup failure", () => {
  it("names the missing variable", () => {
    expect(describeSetupFailure(new Error("DATABASE_URL is not set"))).toMatch(/Set DATABASE_URL/);
  });

  it("explains a hostname that does not resolve", () => {
    expect(describeSetupFailure({ code: "ENOTFOUND" })).toMatch(/does not resolve/);
  });

  it("points an IPv6-only timeout at the pooler", () => {
    expect(describeSetupFailure({ code: "ETIMEDOUT" })).toMatch(/pooler/);
  });

  it("explains a rejected password without repeating it", () => {
    const described = describeSetupFailure({ code: "28P01" });
    expect(described).toMatch(/rejected the password/);
    expect(described).not.toMatch(/postgresql:\/\//);
  });

  it("tells an operator the migration has not run", () => {
    expect(describeSetupFailure({ code: "42P01" })).toMatch(/migration .* has not been applied/);
  });

  it("leaves a real bug alone so it still throws", () => {
    expect(describeSetupFailure(new TypeError("cannot read property of undefined"))).toBeNull();
    expect(describeSetupFailure({ code: "23505" })).toBeNull();
  });
});
