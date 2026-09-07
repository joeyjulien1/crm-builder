import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), withoutTenant: vi.fn(), withTenant: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/db/client", () => ({ withoutTenant: mocks.withoutTenant, withTenant: mocks.withTenant, getPool: vi.fn() }));
import { getSession } from "./session";

describe("session identity", () => {
  beforeEach(() => vi.clearAllMocks());
  it("never recovers another user's development session without a cookie", async () => {
    mocks.cookies.mockResolvedValue({ get: () => undefined });
    expect(await getSession()).toBeNull();
    expect(mocks.withoutTenant).not.toHaveBeenCalled();
    expect(mocks.withTenant).not.toHaveBeenCalled();
  });
  it("rejects an unknown or expired cookie before loading tenant data", async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "invalid-token" }) });
    mocks.withoutTenant.mockResolvedValue([]);
    expect(await getSession()).toBeNull();
    expect(mocks.withTenant).not.toHaveBeenCalled();
  });
  it("requires membership in the session's workspace", async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "session-token" }) });
    mocks.withoutTenant.mockResolvedValue([{ userId: "user-a", tenantId: "tenant-a", email: "a@example.test", name: "A" }]);
    mocks.withTenant.mockResolvedValue([]);
    expect(await getSession()).toBeNull();
    expect(mocks.withTenant).toHaveBeenCalledWith("tenant-a", expect.any(Function));
  });
});
