import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), tenant: vi.fn(), config: vi.fn(), select: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/db/client", () => ({ withTenant: mocks.tenant }));
vi.mock("@/lib/config/version", () => ({ getCurrentVersion: mocks.config }));
import { GET } from "./route";

describe("workspace export", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const query = { from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: mocks.limit };
    query.from.mockReturnValue(query); query.where.mockReturnValue(query); query.orderBy.mockReturnValue(query);
    mocks.select.mockReturnValue(query);
    mocks.tenant.mockImplementation(async (_tenant, callback) => callback({ select: mocks.select }));
    mocks.session.mockResolvedValue({ tenantId: "tenant-a", tenantName: "A workspace" });
    mocks.config.mockResolvedValue({ config: { objects: [] }, version: 7 });
  });

  it("requires a session before accessing any data", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/export"))).status).toBe(401);
    expect(mocks.tenant).not.toHaveBeenCalled();
  });

  it("streams all pages as valid JSON using only the session's workspace", async () => {
    const page = Array.from({ length: 250 }, (_, index) => ({ id: String(index).padStart(4, "0"), objectKey: "contact", data: { name: `Person ${index}` } }));
    mocks.limit.mockResolvedValueOnce(page).mockResolvedValueOnce([{ id: "0250", objectKey: "contact", data: { name: "Last person" } }]);
    const response = await GET(new Request("http://localhost/api/export"));
    const data = await response.json();
    expect(data).toMatchObject({ format: "crm-studio-backup", formatVersion: 1, workspace: "A workspace", configVersion: 7 });
    expect(data.records).toHaveLength(251);
    expect(new Set(data.records.map((record: { id: string }) => record.id)).size).toBe(251);
    expect(mocks.tenant.mock.calls.every(([tenant]) => tenant === "tenant-a")).toBe(true);
    expect(Object.keys(mocks.select.mock.calls[0]![0])).toEqual(["id", "objectKey", "data", "createdAt", "updatedAt"]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
  });

  it("exports an empty workspace and cancels without fetching subsequent pages", async () => {
    mocks.limit.mockResolvedValue([]);
    const response = await GET(new Request("http://localhost/api/export"));
    expect((await response.json()).records).toEqual([]);
    mocks.limit.mockClear();
    const cancelled = await GET(new Request("http://localhost/api/export"));
    await cancelled.body!.cancel();
    expect(mocks.limit).not.toHaveBeenCalled();
  });
});
