import { describe, expect, it } from "vitest";
import { defaultConfig } from "@/lib/config/default";
import { applyPatches, findField } from "@/lib/config/patch";
import { AGENT_TOOLS, runTool, schemaSummary, type ToolContext } from "./tools";

const context = (): ToolContext => ({
  config: defaultConfig(),
  counts: { contact: 1847, company: 210, deal: 96, activity: 12 },
});

describe("the agent's surface", () => {
  it("offers exactly the tools docs/AGENT-TOOLS.md lists", () => {
    expect(AGENT_TOOLS.map((tool) => tool.name).sort()).toEqual(
      [
        "add_custom_agent",
        "add_field",
        "apply_import",
        "create_automation",
        "create_pipeline",
        "create_relation",
        "create_object",
        "create_screen",
        "create_view",
        "customize_brand",
        "customize_object",
        "delete_object",
        "delete_screen",
        "delete_view",
        "get_config",
        "get_schema_summary",
        "list_connections",
        "propose_import_mapping",
        "remove_custom_agent",
        "request_connection",
        "reset_workspace",
        "remove_field",
        "reorder_fields",
        "rewrite_screen",
        "set_automation_enabled",
        "set_theme",
        "suggest_next",
        "update_automation",
        "update_field",
        "update_pipeline",
        "update_screen",
        "update_plan",
        "update_view",
        "write_screen",
      ].sort(),
    );
  });

  it("has no tool that reads record contents", () => {
    const names = AGENT_TOOLS.map((tool) => tool.name);
    expect(names).not.toContain("get_records");
    expect(names).not.toContain("search_records");
    expect(names).not.toContain("read_record");
  });

  it("has no tool that connects an account by itself", () => {
    const names = AGENT_TOOLS.map((tool) => tool.name);
    // Consent is the user's to give. The agent may only ask.
    expect(names).not.toContain("connect_account");
    expect(names).not.toContain("disconnect_account");
    expect(names).toContain("request_connection");
  });

  it("has no tool for changing a field's type", () => {
    const updateField = AGENT_TOOLS.find((tool) => tool.name === "update_field");
    const properties = (updateField?.input_schema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties)).not.toContain("type");
  });

  it("tells the agent counts and shapes, never contents", () => {
    const summary = JSON.stringify(schemaSummary(context()));
    expect(summary).toContain("1847");
    expect(summary).toContain("fld_contact_email");
    // Nothing in the summary is a customer's data.
    expect(summary).not.toMatch(/@/);
  });
});

describe("tools stage patches rather than results", () => {
  it("turns a label into a field patch with an id and a key", async () => {
    const outcome = await runTool(
      "add_field",
      { object_key: "deal", label: "Renewal date", type: "date" },
      context(),
    );

    expect(outcome.patches).toHaveLength(1);
    const patch = outcome.patches[0]!;
    expect(patch.op).toBe("add_field");
    if (patch.op !== "add_field") throw new Error("wrong patch");
    expect(patch.field.key).toBe("renewal_date");
    expect(patch.field.id).toMatch(/^fld_/);
    expect(patch.field.system).toBe(false);
  });

  it("produces a patch that actually applies", async () => {
    const config = defaultConfig();
    const outcome = await runTool(
      "add_field",
      { object_key: "contact", label: "Source", type: "select", options: ["Referral", "Cold outreach"] },
      { config, counts: {} },
    );

    const next = applyPatches(config, outcome.patches);
    const added = next.objects
      .find((object) => object.key === "contact")!
      .fields.find((field) => field.label === "Source");

    expect(added?.options?.map((option) => option.label)).toEqual(["Referral", "Cold outreach"]);
    expect(added?.options?.map((option) => option.value)).toEqual(["referral", "cold_outreach"]);
  });

  it("does not collide with a key the object already uses", async () => {
    const outcome = await runTool(
      "add_field",
      { object_key: "contact", label: "Email", type: "text" },
      context(),
    );
    const patch = outcome.patches[0]!;
    if (patch.op !== "add_field") throw new Error("wrong patch");
    expect(patch.field.key).toBe("email_2");
  });

  it("returns an error the model can act on rather than throwing", async () => {
    const outcome = await runTool("update_field", { field_id: "fld_nope", label: "X" }, context());
    expect(outcome.isError).toBe(true);
    expect(outcome.message).toMatch(/no field/i);
    expect(outcome.patches).toHaveLength(0);
  });

  it("refuses a renderer that is not one of the three", async () => {
    const outcome = await runTool(
      "create_view",
      { object_key: "deal", name: "Calendar", renderer: "calendar", columns: [] },
      context(),
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.patches).toHaveLength(0);
  });

  it("stages a stage-field rewrite when a pipeline changes", async () => {
    const config = defaultConfig();
    const outcome = await runTool(
      "update_pipeline",
      {
        pipeline_id: "pl_sales",
        stages: [
          { key: "new", label: "New" },
          { key: "won", label: "Closed won", is_won: true },
        ],
        stage_migrations: [
          { from: "qualified", to: "new" },
          { from: "proposal", to: "new" },
          { from: "negotiation", to: "new" },
          { from: "lost", to: "won" },
        ],
      },
      { config, counts: {} },
    );

    const next = applyPatches(config, outcome.patches);
    expect(findField(next, "fld_deal_stage")?.field.options?.map((option) => option.label)).toEqual([
      "New",
      "Closed won",
    ]);
  });

  it("reads a file only through the sampler, and only twenty rows of it", async () => {
    let requested = 0;
    const outcome = await runTool(
      "propose_import_mapping",
      { file_id: "file-1", object_key: "contact" },
      {
        ...context(),
        sampleImportFile: async () => {
          requested++;
          return {
            headers: ["Name", "Email"],
            rows: Array.from({ length: 500 }, (_, index) => [`Person ${index}`, `p${index}@example.com`]),
          };
        },
      },
    );

    expect(requested).toBe(1);
    const payload = JSON.parse(outcome.message) as { sampleRows: string[][] };
    expect(payload.sampleRows).toHaveLength(20);
  });

  it("hands an import back as a proposal, not as a config patch", async () => {
    let proposed: unknown;
    const outcome = await runTool(
      "apply_import",
      { file_id: "file-1", object_key: "contact", mapping: { Name: "fld_contact_name" } },
      { ...context(), onImportProposal: (proposal) => (proposed = proposal) },
    );

    expect(outcome.patches).toHaveLength(0);
    expect(proposed).toMatchObject({ fileId: "file-1", objectKey: "contact" });
  });
});

describe("asking for a connection", () => {
  const withConnections = (connected: boolean): ToolContext => ({
    ...context(),
    connections: [
      { provider: "gmail", label: "Gmail", connected, ...(connected ? { account: "sam@example.com" } : {}) },
    ],
  });

  it("offers the connection to the user rather than making one", async () => {
    let requested: { provider: string; reason: string } | undefined;
    const outcome = await runTool(
      "request_connection",
      { provider: "gmail", reason: "Reading your email needs Gmail." },
      { ...withConnections(false), onConnectRequest: (r) => (requested = r) },
    );

    expect(requested?.provider).toBe("gmail");
    expect(outcome.patches).toEqual([]);
    // The model is told to stop, so it cannot narrate a connection it lacks.
    expect(outcome.message).toMatch(/wait|do not assume/i);
  });

  it("tells the agent to carry on when the account is already connected", async () => {
    let requested = false;
    const outcome = await runTool(
      "request_connection",
      { provider: "gmail", reason: "needed" },
      { ...withConnections(true), onConnectRequest: () => (requested = true) },
    );

    expect(requested).toBe(false);
    expect(outcome.message).toMatch(/already connected/i);
  });

  it("refuses a provider that does not exist", async () => {
    const outcome = await runTool(
      "request_connection",
      { provider: "myspace", reason: "why not" },
      withConnections(false),
    );
    expect(outcome.isError).toBe(true);
  });

  it("reports connection status without leaking a token", async () => {
    const outcome = await runTool("list_connections", {}, withConnections(true));
    const parsed = JSON.parse(outcome.message) as Record<string, unknown>[];
    expect(parsed[0]).toMatchObject({ provider: "gmail", connected: true });
    expect(outcome.message).not.toMatch(/token/i);
  });
});

describe("brand logo uploads", () => {
  const FILE_ID = "123e4567-e89b-12d3-a456-426614174000";
  const withUpload = (
    resolved: { id: string; filename: string; mimeType: string; kind: string } | null,
  ): ToolContext => ({
    ...context(),
    resolveUploadFile: async () => resolved,
  });

  it("stages a logo patch for an attached image", async () => {
    const outcome = await runTool(
      "customize_brand",
      { name: "Acme", logo_file_id: FILE_ID },
      withUpload({ id: FILE_ID, filename: "logo.png", mimeType: "image/png", kind: "image" }),
    );

    expect(outcome.patches).toHaveLength(1);
    const patch = outcome.patches[0]!;
    expect(patch.op).toBe("update_brand");
    if (patch.op !== "update_brand") throw new Error("wrong patch");
    expect(patch.brand.logoFileId).toBe(FILE_ID);
  });

  it("refuses an id that resolves to nothing", async () => {
    const outcome = await runTool(
      "customize_brand",
      { name: "Acme", logo_file_id: FILE_ID },
      withUpload(null),
    );

    expect(outcome.patches).toHaveLength(0);
    expect(outcome.message).toMatch(/could not be found/i);
  });

  it("refuses a non-image file as a logo", async () => {
    const outcome = await runTool(
      "customize_brand",
      { name: "Acme", logo_file_id: FILE_ID },
      withUpload({ id: FILE_ID, filename: "leads.csv", mimeType: "text/csv", kind: "data" }),
    );

    expect(outcome.patches).toHaveLength(0);
    expect(outcome.message).toMatch(/not an image/i);
  });

  it("still brands without a logo when none is attached", async () => {
    const outcome = await runTool("customize_brand", { name: "Acme" }, context());

    expect(outcome.patches).toHaveLength(1);
    const patch = outcome.patches[0]!;
    if (patch.op !== "update_brand") throw new Error("wrong patch");
    expect(patch.brand.logoFileId).toBeUndefined();
  });
});
