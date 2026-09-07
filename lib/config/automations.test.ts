import { describe, expect, it } from "vitest";
import { defaultConfig } from "./default";
import { hydrateConfig } from "./hydrate";
import { applyPatches, PatchError, validateConfig } from "./patch";
import { automationConfigSchema, flattenSteps, normalizeAutomation } from "./schema";
import { describePatch } from "./describe";
import type { AutomationStep, Config, ConfigPatch } from "./types";

/**
 * Workflows were `{ trigger, conditions[], actions[] }` and are now
 * `{ trigger, steps[] }`. Configs live in JSONB and are never re-parsed on
 * read, so every workspace saved before the change still arrives in the old
 * shape — and a reader that only understands the new one would empty their
 * workflows silently rather than failing loudly.
 */
const legacy = {
  id: "au_old",
  name: "Chase stale deals",
  enabled: true,
  trigger: { type: "record_created", objectKey: "deal" },
  conditions: [{ fieldId: "fld_deal_amount", operator: "gt", value: 1000 }],
  actions: [
    { type: "create_task", title: "Call them", dueInDays: 1 },
    { type: "send_email", to: "sales@example.com", subject: "Big deal", body: "Have a look." },
  ],
};

describe("reading a workflow written before steps existed", () => {
  it("turns its conditions into a leading filter step", () => {
    const parsed = automationConfigSchema.parse(legacy);

    expect(parsed.steps).toHaveLength(3);
    expect(parsed.steps[0]).toMatchObject({
      type: "filter",
      conditions: [{ fieldId: "fld_deal_amount", operator: "gt", value: 1000 }],
    });
    expect(parsed.steps[1]).toMatchObject({ type: "create_task", title: "Call them" });
    expect(parsed.steps[2]).toMatchObject({ type: "send_email", to: "sales@example.com" });
  });

  it("leaves a workflow with no conditions as just its actions", () => {
    const parsed = automationConfigSchema.parse({ ...legacy, conditions: [] });
    expect(parsed.steps.map((step) => step.type)).toEqual(["create_task", "send_email"]);
  });

  it("mints the same ids however many times it runs", () => {
    const once = normalizeAutomation(legacy);
    const twice = normalizeAutomation(structuredClone(legacy));
    expect(once).toEqual(twice);

    // And normalising something already normalised leaves it alone.
    expect(normalizeAutomation(once)).toEqual(once);
  });

  it("comes through the read path, which is where a stored config arrives", () => {
    const stored = { ...defaultConfig(), automations: [legacy] } as unknown as Config;
    const hydrated = hydrateConfig(stored);
    expect(hydrated.automations[0]?.steps.map((step) => step.type)).toEqual([
      "filter",
      "create_task",
      "send_email",
    ]);
  });
});

describe("workflow steps", () => {
  const base = defaultConfig();

  const workflow = (steps: AutomationStep[]): ConfigPatch => ({
    op: "create_automation",
    automation: {
      id: "au_new",
      name: "Onboarding",
      enabled: false,
      trigger: { type: "record_created", objectKey: "deal" },
      steps,
    },
  });

  it("round-trips filter, delay and branch through a patch", () => {
    const steps: AutomationStep[] = [
      { id: "s1", type: "filter", conditions: [{ fieldId: "fld_deal_amount", operator: "gt", value: 10 }] },
      { id: "s2", type: "delay", amount: 2, unit: "days" },
      {
        id: "s3",
        type: "branch",
        paths: [
          {
            id: "p1",
            label: "Large",
            conditions: [{ fieldId: "fld_deal_amount", operator: "gte", value: 10000 }],
            steps: [{ id: "s4", type: "create_task", title: "Ring the client", dueInDays: 0 }],
          },
        ],
        otherwise: [{ id: "s5", type: "create_task", title: "Send the standard note", dueInDays: 2 }],
      },
    ];

    const next = applyPatches(base, [workflow(steps)]);
    expect(next.automations[0]?.steps).toEqual(steps);

    // And back out again through a full validate, which is what a rollback does.
    expect(validateConfig(next).automations[0]?.steps).toEqual(steps);
  });

  it("replaces the whole program on update, so a workflow is edited by sending it back", () => {
    const created = applyPatches(base, [
      workflow([{ id: "s1", type: "create_task", title: "One", dueInDays: 0 }]),
    ]);

    const updated = applyPatches(created, [
      {
        op: "update_automation",
        automationId: "au_new",
        steps: [
          { id: "s1", type: "create_task", title: "One", dueInDays: 0 },
          { id: "s2", type: "delay", amount: 3, unit: "hours" },
        ],
      },
    ]);

    expect(updated.automations[0]?.steps.map((step) => step.type)).toEqual(["create_task", "delay"]);
  });

  it("still accepts an update in the old shape, because stored patches replay", () => {
    const created = applyPatches(base, [
      workflow([{ id: "s1", type: "create_task", title: "One", dueInDays: 0 }]),
    ]);

    const updated = applyPatches(created, [
      {
        op: "update_automation",
        automationId: "au_new",
        conditions: [{ fieldId: "fld_deal_amount", operator: "gt", value: 5 }],
        actions: [{ type: "create_task", title: "Two", dueInDays: 0 }],
      } as ConfigPatch,
    ]);

    expect(updated.automations[0]?.steps.map((step) => step.type)).toEqual(["filter", "create_task"]);
  });

  it("refuses branches nested deeper than anyone can read", () => {
    const nest = (depth: number): AutomationStep =>
      depth === 0
        ? { id: `leaf_${depth}`, type: "create_task", title: "Do it", dueInDays: 0 }
        : {
            id: `br_${depth}`,
            type: "branch",
            paths: [{ id: `p_${depth}`, label: "Deeper", conditions: [], steps: [nest(depth - 1)] }],
          };

    expect(() => applyPatches(base, [workflow([nest(4)])])).toThrow(PatchError);
  });

  it("refuses two steps with the same id, which would confuse a resume", () => {
    expect(() =>
      applyPatches(base, [
        workflow([
          { id: "same", type: "create_task", title: "One", dueInDays: 0 },
          { id: "same", type: "create_task", title: "Two", dueInDays: 0 },
        ]),
      ]),
    ).toThrow(PatchError);
  });

  it("counts every step, however deep, when it flattens", () => {
    const steps: AutomationStep[] = [
      {
        id: "b",
        type: "branch",
        paths: [
          { id: "p", label: "One", conditions: [], steps: [{ id: "x", type: "delay", amount: 1, unit: "days" }] },
        ],
        otherwise: [{ id: "y", type: "create_task", title: "Else", dueInDays: 0 }],
      },
    ];
    expect(flattenSteps(steps).map((step) => step.id)).toEqual(["b", "x", "y"]);
  });

  it("describes a change in words, not JSON", () => {
    const created = applyPatches(base, [
      workflow([{ id: "s1", type: "create_task", title: "One", dueInDays: 0 }]),
    ]);

    const summary = describePatch(
      {
        op: "update_automation",
        automationId: "au_new",
        steps: [
          { id: "s1", type: "delay", amount: 2, unit: "days" },
          { id: "s2", type: "send_email", to: "a@example.com", subject: "Hi", body: "There" },
        ],
      },
      created,
    );

    expect(summary).toContain("waits 2 days");
    expect(summary).toContain("sends an email to a@example.com");
  });
});
