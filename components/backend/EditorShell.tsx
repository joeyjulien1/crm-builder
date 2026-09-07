"use client";

import * as React from "react";
import { AlertTriangle, Sparkles, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { fieldControls, nodeControls, stepControls, triggerControls, type ControlGroup } from "@/lib/config/controls";
import {
  studioButtonPrimary,
  studioButtonSecondary,
  studioError,
  studioEyebrow,
  studioIconChip,
  studioSubtitle,
  studioTitle,
} from "@/components/builder/studio-chrome";
import { cn } from "@/lib/utils";
import { DataMap } from "./DataMap";
import { DataObjectView } from "./DataObjectView";
import { Inspector, InspectorEmpty } from "./Inspector";
import { RunPanel, type RunSummary, type TestResult } from "./RunPanel";
import { ScreenView } from "./ScreenView";
import { StructureTree } from "./StructureTree";
import { WebhookEndpoint } from "./WebhookEndpoint";
import { WorkflowBuilder } from "./WorkflowBuilder";
import { hasBuiltBackend, nodeLabel } from "./describe";
import { mintId } from "./ids";
import { insertChild, moveChild, newNode, nodeAt, removeNode, replaceNode, withIds } from "./node-tree";
import { findStep, updateStep } from "./step-tree";
import { sectionFor, type Section, type Selection } from "./selection";
import { useConfigEdit, type ApplyResult } from "./useConfigEdit";
import { NODE_KINDS } from "@/lib/config/schema";
import type {
  AutomationConfig,
  AutomationStep,
  Config,
  ConfigPatch,
  FieldConfig,
  ObjectConfig,
  ScreenConfig,
  UiNode,
} from "@/lib/config/types";

/**
 * The backend editor.
 *
 * Three panes: what this workspace is made of, what the selected thing looks
 * like, and its settings. Shopify's shape, because it is the right one for
 * configuration you have to *find* before you can change it — the previous
 * backend was a read-only explorer whose only control was a toggle, and every
 * other change meant describing it to the agent and waiting.
 *
 * The agent has not lost anything. Both authors write the same patches through
 * the same endpoint, so a hand edit is versioned, diffable and revertible
 * exactly like a generated one, and the two appear side by side in history.
 */
export function EditorShell({
  config,
  canEditConfig,
  onApplyPatches,
  onAskAgent,
}: {
  config: Config;
  canEditConfig?: boolean;
  onApplyPatches?: (patches: ConfigPatch[]) => Promise<ApplyResult>;
  onAskAgent?: (prompt: string) => void;
}) {
  const apply = React.useCallback(
    async (patches: ConfigPatch[]) =>
      onApplyPatches
        ? onApplyPatches(patches)
        : { success: false, error: "This workspace cannot be edited here." },
    [onApplyPatches],
  );
  const edit = useConfigEdit(apply, Boolean(canEditConfig));

  const [section, setSection] = React.useState<Section>("workflows");
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const [addingTo, setAddingTo] = React.useState<{ screenId: string; parentPath: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<{ field: FieldConfig; objectKey: string; affected?: number } | null>(null);

  const [test, setTest] = React.useState<TestResult | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [runs, setRuns] = React.useState<RunSummary[]>([]);
  const [loadingRuns, setLoadingRuns] = React.useState(false);

  // A selection that no longer exists — the agent deleted the screen, someone
  // rolled back — points at nothing. Drop it rather than rendering a ghost.
  React.useEffect(() => {
    if (!selection) return;
    const alive =
      selection.kind === "object" || selection.kind === "field"
        ? config.objects.some((object) => object.key === selection.objectKey)
        : selection.kind === "screen" || selection.kind === "node"
          ? (config.screens ?? []).some((screen) => screen.id === selection.screenId)
          : config.automations.some((automation) => automation.id === selection.automationId);
    if (!alive) setSelection(null);
  }, [config, selection]);

  const select = (next: Selection) => {
    setSelection(next);
    const nextSection = sectionFor(next);
    if (nextSection) setSection(nextSection);
    edit.clearError();
  };

  /* ---------------------------------------------------------------- lookups */

  const object: ObjectConfig | undefined =
    selection?.kind === "object" || selection?.kind === "field"
      ? config.objects.find((candidate) => candidate.key === selection.objectKey)
      : undefined;
  const field: FieldConfig | undefined =
    selection?.kind === "field" ? object?.fields.find((candidate) => candidate.id === selection.fieldId) : undefined;
  const screen: ScreenConfig | undefined =
    selection?.kind === "screen" || selection?.kind === "node"
      ? (config.screens ?? []).find((candidate) => candidate.id === selection.screenId)
      : undefined;
  const node: UiNode | undefined =
    selection?.kind === "node" && screen?.root ? nodeAt(screen.root, selection.path) : undefined;
  const automation: AutomationConfig | undefined =
    selection?.kind === "workflow" || selection?.kind === "trigger" || selection?.kind === "step"
      ? config.automations.find((candidate) => candidate.id === selection.automationId)
      : undefined;
  const step: AutomationStep | undefined =
    selection?.kind === "step" && automation
      ? findStep(automation.steps, selection.lane, selection.index)
      : undefined;

  /* ---------------------------------------------------------------- writing */

  const commit = (patches: ConfigPatch[]) => void edit.commit(patches);

  const writeScreen = (target: ScreenConfig, root: UiNode) =>
    commit([{ op: "update_screen", screenId: target.id, root: withIds(root) }]);

  const writeSteps = (target: AutomationConfig, steps: AutomationStep[]) =>
    commit([{ op: "update_automation", automationId: target.id, steps }]);

  const createWorkflow = async () => {
    const objectKey = config.objects[0]?.key;
    if (!objectKey) return;
    const id = mintId("aut");
    const result = await edit.commit([
      {
        op: "create_automation",
        automation: {
          id,
          name: "New workflow",
          enabled: false,
          trigger: { type: "record_created", objectKey },
          steps: [{ id: mintId("stp"), type: "create_task", title: "Follow up", dueInDays: 1 }],
        },
      },
    ]);
    if (result.success) select({ kind: "workflow", automationId: id });
  };

  const removeField = async () => {
    if (!confirmDelete) return;
    const result = await edit.commit([{ op: "remove_field", fieldId: confirmDelete.field.id }]);
    if (result.success) {
      setConfirmDelete(null);
      setSelection({ kind: "object", objectKey: confirmDelete.objectKey });
    }
  };

  const askToDelete = async (target: FieldConfig, objectKey: string) => {
    setConfirmDelete({ field: target, objectKey });
    // The count comes from the same impact pass ConfigDiff uses, so the number
    // in the dialog is the number the agent would have shown.
    try {
      const response = await fetch("/api/config/impact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patches: [{ op: "remove_field", fieldId: target.id }] }),
      });
      if (!response.ok) return;
      const impact = (await response.json()) as { items: { affectedRecords?: number }[] };
      setConfirmDelete((current) =>
        current && current.field.id === target.id
          ? { ...current, affected: impact.items[0]?.affectedRecords ?? 0 }
          : current,
      );
    } catch {
      // A count we could not fetch is not a reason to block the delete; the
      // dialog simply says less.
    }
  };

  /* ------------------------------------------------------------ test + runs */

  const loadRuns = React.useCallback(async (automationId: string) => {
    setLoadingRuns(true);
    try {
      const response = await fetch(`/api/automations/runs?automationId=${encodeURIComponent(automationId)}`);
      if (!response.ok) return;
      const body = (await response.json()) as { runs: RunSummary[] };
      setRuns(body.runs);
    } catch {
      setRuns([]);
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const shownWorkflowId = automation?.id;
  React.useEffect(() => {
    setTest(null);
    if (shownWorkflowId) void loadRuns(shownWorkflowId);
    else setRuns([]);
  }, [shownWorkflowId, loadRuns]);

  const runTest = async (target: AutomationConfig) => {
    setTesting(true);
    setTest(null);
    try {
      const response = await fetch("/api/automations/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ automationId: target.id }),
      });
      if (!response.ok) {
        setTest({ reports: [], missingMergeFields: [], error: await response.text() });
        return;
      }
      setTest((await response.json()) as TestResult);
    } catch {
      setTest({ reports: [], missingMergeFields: [], error: "The test could not be run. Try again." });
    } finally {
      setTesting(false);
    }
  };

  /* ----------------------------------------------------------------- render */

  if (!hasBuiltBackend(config)) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-[#09090b] px-6 text-center text-zinc-100">
        <div className="flex max-w-md flex-col items-center">
          <div className={cn(studioIconChip, "mb-4 h-12 w-12")}>
            <WorkflowIcon size={21} aria-hidden="true" />
          </div>
          <h1 className={cn(studioTitle, "text-3xl")}>Build your backend</h1>
          <p className={cn(studioSubtitle, "mt-2")}>
            Data, screens and workflows live here. Describe the CRM you want and shape what comes back.
          </p>
          {canEditConfig && onAskAgent && (
            <button
              type="button"
              className={cn(studioButtonPrimary, "mt-5")}
              onClick={() =>
                onAskAgent("Build the first version of this CRM. Ask me what the business does first.")
              }
            >
              <Sparkles size={14} aria-hidden="true" />
              Start with the agent
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-[#09090b] text-zinc-100">
      <StructureTree
        config={config}
        section={section}
        selection={selection}
        canEdit={edit.canEdit}
        onSection={(next) => {
          setSection(next);
          setSelection(null);
        }}
        onSelect={select}
        onAddWorkflow={() => void createWorkflow()}
        onAddNode={(screenId, parentPath) => setAddingTo({ screenId, parentPath })}
        onRemoveNode={(screenId, path) => {
          const target = (config.screens ?? []).find((candidate) => candidate.id === screenId);
          if (!target?.root) return;
          writeScreen(target, removeNode(target.root, path));
          setSelection({ kind: "screen", screenId });
        }}
        onMoveNode={(screenId, parentPath, from, to) => {
          const target = (config.screens ?? []).find((candidate) => candidate.id === screenId);
          if (!target?.root) return;
          writeScreen(target, moveChild(target.root, parentPath, from, to));
        }}
      />

      <main className="relative min-w-0 flex-1 overflow-y-auto">
        {edit.error && (
          <div className="sticky top-0 z-10 px-6 pt-4">
            <p role="alert" className={studioError}>
              {edit.error}
            </p>
          </div>
        )}

        {section === "data" && !object && (
          <DataMap
            config={config}
            selectedObjectKey={undefined}
            onSelectObject={(objectKey) => select({ kind: "object", objectKey })}
          />
        )}

        {object && (
          <DataObjectView
            object={object}
            config={config}
            selection={selection}
            canEdit={edit.canEdit}
            saving={edit.saving}
            onSelect={select}
            onCommit={commit}
          />
        )}

        {section === "screens" && !screen && (
          <Placeholder>Pick a screen on the left to see how it is put together.</Placeholder>
        )}

        {screen && (
          <ScreenView
            screen={screen}
            config={config}
            selection={selection}
            canEdit={edit.canEdit}
            onSelect={select}
            onRename={(name) => commit([{ op: "update_screen", screenId: screen.id, name }])}
            onRewrite={(source) => commit([{ op: "update_screen", screenId: screen.id, source }])}
          />
        )}

        {section === "workflows" && !automation && (
          <Placeholder>
            Pick a workflow, or start one. A workflow is a trigger and then whatever should happen.
          </Placeholder>
        )}

        {automation && (
          <>
            <WorkflowBuilder
              automation={automation}
              config={config}
              selection={selection}
              canEdit={edit.canEdit}
              saving={edit.saving}
              onSelect={select}
              onChangeSteps={(steps) => writeSteps(automation, steps)}
              onRename={(name) => commit([{ op: "update_automation", automationId: automation.id, name }])}
              onToggleEnabled={() =>
                commit([
                  { op: "set_automation_enabled", automationId: automation.id, enabled: !automation.enabled },
                ])
              }
              onTest={() => void runTest(automation)}
            />
            <RunPanel
              test={test}
              testing={testing}
              runs={runs}
              loadingRuns={loadingRuns}
              onRefresh={() => void loadRuns(automation.id)}
            />
          </>
        )}
      </main>

      <aside className="hidden w-72 shrink-0 border-l border-zinc-800/80 bg-[#0c0c0e] xl:block">
        {field && object ? (
          <Inspector
            title={field.label}
            subtitle={`Field on ${object.labelPlural}`}
            groups={fieldControls(field.type)}
            value={field}
            context={{ config }}
            disabled={!edit.canEdit || field.system}
            onCommit={(next) =>
              commit([
                {
                  op: "update_field",
                  fieldId: field.id,
                  label: next.label,
                  required: next.required,
                  helpText: next.helpText,
                  ...(next.options ? { options: next.options } : {}),
                },
              ])
            }
            footer={
              edit.canEdit && !field.system ? (
                <DangerZone
                  label={`Remove ${field.label}`}
                  onClick={() => void askToDelete(field, object.key)}
                />
              ) : field.system ? (
                <p className="px-3.5 py-3 text-[11px] text-zinc-600">
                  Built in. It can be renamed, but the product depends on it existing.
                </p>
              ) : null
            }
          />
        ) : object ? (
          <Inspector
            title={object.labelPlural}
            subtitle="Data object"
            groups={OBJECT_GROUPS}
            value={object}
            context={{ config }}
            disabled={!edit.canEdit}
            onCommit={(next) =>
              commit([
                {
                  op: "update_object_label",
                  objectKey: object.key,
                  label: next.label,
                  labelPlural: next.labelPlural,
                },
              ])
            }
          />
        ) : node && screen && selection?.kind === "node" ? (
          <Inspector
            title={nodeLabel(node)}
            subtitle={`${node.kind} on ${screen.name}`}
            groups={nodeControls(node.kind)}
            value={node}
            context={{ config }}
            disabled={!edit.canEdit}
            onCommit={(next) => screen.root && writeScreen(screen, replaceNode(screen.root, selection.path, next))}
            footer={
              edit.canEdit && selection.path !== "root" ? (
                <DangerZone
                  label={`Remove this ${node.kind}`}
                  onClick={() => {
                    if (!screen.root) return;
                    writeScreen(screen, removeNode(screen.root, selection.path));
                    setSelection({ kind: "screen", screenId: screen.id });
                  }}
                />
              ) : null
            }
          />
        ) : screen ? (
          <Inspector
            title={screen.name}
            subtitle="Screen"
            groups={SCREEN_GROUPS}
            value={screen}
            context={{ config }}
            disabled={!edit.canEdit}
            onCommit={(next) =>
              commit([
                { op: "update_screen", screenId: screen.id, name: next.name, icon: next.icon, position: next.position },
              ])
            }
          />
        ) : automation && selection?.kind === "trigger" ? (
          <Inspector
            title="Trigger"
            subtitle={automation.name}
            groups={triggerControls(automation.trigger.type)}
            value={automation.trigger}
            context={{ config, triggerObjectKey: automation.trigger.objectKey }}
            disabled={!edit.canEdit}
            onCommit={(next) =>
              commit([{ op: "update_automation", automationId: automation.id, trigger: next }])
            }
            footer={
              automation.trigger.type === "webhook_received" ? (
                <WebhookEndpoint
                  automationId={automation.id}
                  objectKey={automation.trigger.objectKey}
                  canEdit={edit.canEdit}
                />
              ) : null
            }
          />
        ) : automation && step && selection?.kind === "step" ? (
          <Inspector
            title={STEP_TITLES[step.type]}
            subtitle={automation.name}
            groups={stepControls(step.type)}
            value={step}
            context={{ config, triggerObjectKey: automation.trigger.objectKey }}
            disabled={!edit.canEdit}
            onCommit={(next) =>
              writeSteps(automation, updateStep(automation.steps, selection.lane, selection.index, next))
            }
            footer={
              step.type === "branch" ? (
                <p className="px-3.5 py-3 text-[11px] leading-relaxed text-zinc-600">
                  A branch&apos;s paths are edited on the card itself, where you can see what is inside each one.
                </p>
              ) : (
                <MergeFieldHint automation={automation} config={config} />
              )
            }
          />
        ) : automation ? (
          <Inspector
            title={automation.name}
            subtitle="Workflow"
            groups={WORKFLOW_GROUPS}
            value={automation}
            context={{ config, triggerObjectKey: automation.trigger.objectKey }}
            disabled={!edit.canEdit}
            onCommit={(next) =>
              commit([
                { op: "update_automation", automationId: automation.id, name: next.name, description: next.description },
              ])
            }
          />
        ) : (
          <InspectorEmpty>
            Pick something on the left. Whatever you choose, its settings appear here.
          </InspectorEmpty>
        )}
      </aside>

      {addingTo && (
        <AddBlockDialog
          config={config}
          onCancel={() => setAddingTo(null)}
          onPick={(kind) => {
            const target = (config.screens ?? []).find((candidate) => candidate.id === addingTo.screenId);
            setAddingTo(null);
            if (!target?.root) return;
            const objectKey = config.objects[0]?.key ?? "contact";
            const pipelineId = config.pipelines[0]?.id;
            const added = newNode(kind, objectKey, pipelineId);
            const parent = nodeAt(target.root, addingTo.parentPath);
            const index = (parent?.children ?? []).length;
            writeScreen(target, insertChild(target.root, addingTo.parentPath, added));
            setSelection({
              kind: "node",
              screenId: target.id,
              path: `${addingTo.parentPath}.children.${index}`,
            });
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Remove ${confirmDelete.field.label}?`}
          body={
            confirmDelete.affected === undefined
              ? "Checking how many records hold a value…"
              : confirmDelete.affected === 0
                ? "No records hold a value for this field."
                : `${confirmDelete.affected} ${confirmDelete.affected === 1 ? "record holds" : "records hold"} a value for this field. Removing it drops that data.`
          }
          confirmLabel="Remove field"
          busy={edit.saving}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void removeField()}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Inspector groups for the things that are not nodes, fields or steps         */
/* -------------------------------------------------------------------------- */

const OBJECT_GROUPS: ControlGroup[] = [
  {
    label: "Object",
    controls: [
      { kind: "text", key: "label", label: "Name", max: 60, help: "One of them, e.g. Client." },
      { kind: "text", key: "labelPlural", label: "Plural", max: 60 },
    ],
  },
];

const SCREEN_GROUPS: ControlGroup[] = [
  {
    label: "Screen",
    controls: [
      { kind: "text", key: "name", label: "Name", max: 60 },
      { kind: "text", key: "icon", label: "Icon", max: 30, help: "A Lucide icon name, e.g. LayoutDashboard." },
      { kind: "number", key: "position", label: "Order", min: 0, max: 999 },
    ],
  },
];

const WORKFLOW_GROUPS: ControlGroup[] = [
  {
    label: "Workflow",
    controls: [
      { kind: "text", key: "name", label: "Name", max: 80 },
      { kind: "text", key: "description", label: "Note", max: 200, help: "What this is for, for whoever reads it next." },
    ],
  },
];

const STEP_TITLES: Record<AutomationStep["type"], string> = {
  filter: "Only continue if",
  delay: "Wait",
  branch: "Branch",
  set_field: "Update a field",
  create_record: "Create a record",
  create_task: "Create a task",
  send_email: "Send an email",
  call_webhook: "Call a webhook",
  send_slack: "Post to Slack",
  send_sms: "Send a text",
};

/* -------------------------------------------------------------------------- */
/* Small pieces                                                                */
/* -------------------------------------------------------------------------- */

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className="max-w-xs text-xs leading-relaxed text-zinc-600">{children}</p>
    </div>
  );
}

function DangerZone({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="p-3.5">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-[11px] text-zinc-400 transition-colors hover:border-red-900 hover:text-red-400"
        onClick={onClick}
      >
        <Trash2 size={12} aria-hidden="true" />
        {label}
      </button>
    </div>
  );
}

/** The tokens this workflow's steps can use, listed where they get typed. */
function MergeFieldHint({ automation, config }: { automation: AutomationConfig; config: Config }) {
  const object = config.objects.find((candidate) => candidate.key === automation.trigger.objectKey);
  if (!object) return null;

  return (
    <div className="border-t border-zinc-800/60 p-3.5">
      <p className={cn(studioEyebrow, "mb-1.5")}>Merge fields</p>
      <p className="mb-2 text-[11px] leading-relaxed text-zinc-600">
        Type these into any text box to fill in the record&apos;s own values.
      </p>
      <div className="flex flex-wrap gap-1">
        {object.fields.slice(0, 12).map((field) => (
          <code
            key={field.id}
            title={field.label}
            className="rounded border border-zinc-800 bg-[#131316] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
          >
            {`{{${field.key}}}`}
          </code>
        ))}
      </div>
    </div>
  );
}

const KIND_GROUPS: { label: string; kinds: UiNode["kind"][] }[] = [
  { label: "Layout", kinds: ["stack", "grid", "card", "section", "panel", "tabs", "tab", "divider", "spacer"] },
  { label: "Content", kinds: ["heading", "text", "metric", "badge"] },
  { label: "Data", kinds: ["table", "board", "list", "chart"] },
  { label: "Input", kinds: ["form", "record_detail", "search", "filters", "button"] },
];

function AddBlockDialog({
  config,
  onPick,
  onCancel,
}: {
  config: Config;
  onPick: (kind: UiNode["kind"]) => void;
  onCancel: () => void;
}) {
  const hasPipeline = config.pipelines.length > 0;

  return (
    <Overlay onCancel={onCancel}>
      <h2 className="mb-1 text-sm font-semibold text-white">Add a block</h2>
      <p className="mb-3 text-[11px] text-zinc-500">
        These are the blocks screens are built from. Pick one, then set it up on the right.
      </p>
      <div className="flex max-h-[24rem] flex-col gap-3 overflow-y-auto">
        {KIND_GROUPS.map((group) => (
          <div key={group.label}>
            <p className={cn(studioEyebrow, "mb-1.5")}>{group.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.kinds
                .filter((kind) => NODE_KINDS.includes(kind))
                .map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    disabled={kind === "board" && !hasPipeline}
                    title={kind === "board" && !hasPipeline ? "A board needs a pipeline first" : undefined}
                    className="rounded-lg border border-zinc-800 px-2.5 py-1.5 text-[11px] text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white disabled:opacity-40"
                    onClick={() => onPick(kind)}
                  >
                    {kind.replace("_", " ")}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </Overlay>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Overlay onCancel={onCancel}>
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">{body}</p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={studioButtonSecondary} onClick={onCancel}>
          Keep it
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-red-900 bg-red-950/60 px-2.5 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-950 disabled:opacity-40"
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Overlay>
  );
}

function Overlay({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-800 bg-[#131316] p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
