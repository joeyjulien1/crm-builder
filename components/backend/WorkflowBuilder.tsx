"use client";

import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  Clock,
  Database,
  Filter as FilterIcon,
  GitBranch,
  GripVertical,
  ListChecks,
  Mail,
  MessageCircle,
  MessageSquare,
  PencilLine,
  Play,
  Plus,
  Trash2,
  Webhook,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { STEP_BLURBS, STEP_LABELS } from "@/lib/config/controls";
import { studioCard, studioButtonSecondary, studioEyebrow, studioPillOff, studioPillOn } from "@/components/builder/studio-chrome";
import { cn } from "@/lib/utils";
import { describeConditions, describeStep, describeTrigger } from "./describe";
import { ConditionRows, Select, TextInput } from "./controls";
import {
  insertStep,
  laneAt,
  moveStep,
  newStep,
  OTHERWISE,
  removeStep,
  replaceLane,
  stepIsIncomplete,
  type LanePath,
} from "./step-tree";
import { mintId } from "./ids";
import type { Selection } from "./selection";
import type { AutomationConfig, AutomationStep, Config } from "@/lib/config/types";

/**
 * The workflow builder: a trigger, then an ordered list of steps.
 *
 * A list rather than a canvas, and deliberately. The thing people need to read
 * off a workflow is *what happens in what order*, which a column says in one
 * glance and a graph makes you trace. Branches indent into lanes instead of
 * fanning out, so nesting stays legible at a glance too.
 *
 * Every edit here rewrites the whole `steps` array and commits one
 * `update_automation` patch. There is no partial save and no local draft that
 * could drift from the config.
 */

const STEP_ICONS: Record<AutomationStep["type"], LucideIcon> = {
  filter: FilterIcon,
  delay: Clock,
  branch: GitBranch,
  set_field: PencilLine,
  create_record: Database,
  create_task: ListChecks,
  send_email: Mail,
  call_webhook: Webhook,
  send_slack: MessageSquare,
  send_sms: MessageCircle,
};

const ACTION_TYPES: AutomationStep["type"][] = [
  "set_field",
  "create_record",
  "create_task",
  "send_email",
  "send_slack",
  "send_sms",
  "call_webhook",
];
const CONTROL_TYPES: AutomationStep["type"][] = ["filter", "delay", "branch"];

export function WorkflowBuilder({
  automation,
  config,
  selection,
  canEdit,
  saving,
  onSelect,
  onChangeSteps,
  onRename,
  onToggleEnabled,
  onTest,
}: {
  automation: AutomationConfig;
  config: Config;
  selection: Selection | null;
  canEdit: boolean;
  saving: boolean;
  onSelect: (selection: Selection) => void;
  onChangeSteps: (steps: AutomationStep[]) => void;
  onRename: (name: string) => void;
  onToggleEnabled: () => void;
  onTest: () => void;
}) {
  const selectedStep =
    selection?.kind === "step" && selection.automationId === automation.id ? selection : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3 px-6 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="max-w-sm">
            <TextInput
              value={automation.name}
              disabled={!canEdit}
              maxLength={80}
              onCommit={(name) => name.trim() && onRename(name.trim())}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-500">
            {automation.steps.length} {automation.steps.length === 1 ? "step" : "steps"} ·{" "}
            {automation.enabled ? "running on every matching record" : "paused"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className={studioButtonSecondary}
            onClick={onTest}
            disabled={saving}
            title="Run this workflow against one record without changing anything"
          >
            <Play size={13} aria-hidden="true" />
            Test workflow
          </button>
          <button
            type="button"
            className={automation.enabled ? studioPillOn : studioPillOff}
            disabled={!canEdit || saving}
            aria-pressed={automation.enabled}
            onClick={onToggleEnabled}
          >
            {automation.enabled ? "On" : "Off"}
          </button>
        </div>
      </header>

      <button
        type="button"
        className={cn(
          studioCard,
          "flex items-center gap-3 p-3 text-left transition-colors",
          selection?.kind === "trigger" && selection.automationId === automation.id
            ? "border-zinc-600 bg-zinc-900"
            : "hover:border-zinc-700",
        )}
        onClick={() => onSelect({ kind: "trigger", automationId: automation.id })}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300">
          <Zap size={14} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className={cn(studioEyebrow, "block")}>Trigger</span>
          <span className="block truncate text-xs text-zinc-200">
            {describeTrigger(automation, config)}
          </span>
        </span>
      </button>

      <StepLane
        steps={automation.steps}
        lane={[]}
        automation={automation}
        config={config}
        selectedStep={selectedStep}
        canEdit={canEdit}
        onSelect={onSelect}
        onChangeSteps={onChangeSteps}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One lane of steps — the workflow itself, or the inside of a branch path      */
/* -------------------------------------------------------------------------- */

function StepLane({
  steps,
  lane,
  automation,
  config,
  selectedStep,
  canEdit,
  onSelect,
  onChangeSteps,
  compact,
}: {
  steps: AutomationStep[];
  lane: LanePath;
  automation: AutomationConfig;
  config: Config;
  selectedStep: (Selection & { kind: "step" }) | null;
  canEdit: boolean;
  onSelect: (selection: Selection) => void;
  onChangeSteps: (steps: AutomationStep[]) => void;
  compact?: boolean;
}) {
  const list = laneAt(steps, lane);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = list.findIndex((step) => step.id === active.id);
    const to = list.findIndex((step) => step.id === over.id);
    if (from === -1 || to === -1) return;
    onChangeSteps(moveStep(steps, lane, from, to));
  };

  return (
    <div className="flex flex-col">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={list.map((step) => step.id)} strategy={verticalListSortingStrategy}>
          {list.map((step, index) => (
            <div key={step.id} className="flex flex-col">
              <AddHere
                canEdit={canEdit}
                objectKey={automation.trigger.objectKey}
                onAdd={(type) =>
                  onChangeSteps(insertStep(steps, lane, index, newStep(type, automation.trigger.objectKey)))
                }
              />
              <SortableStep
                step={step}
                index={index}
                lane={lane}
                automation={automation}
                config={config}
                selectedStep={selectedStep}
                canEdit={canEdit}
                onSelect={onSelect}
                onChangeSteps={onChangeSteps}
                steps={steps}
              />
            </div>
          ))}
        </SortableContext>
      </DndContext>

      <AddHere
        canEdit={canEdit}
        objectKey={automation.trigger.objectKey}
        last={list.length === 0}
        compact={compact}
        onAdd={(type) =>
          onChangeSteps(insertStep(steps, lane, list.length, newStep(type, automation.trigger.objectKey)))
        }
      />
    </div>
  );
}

function SortableStep(props: {
  step: AutomationStep;
  index: number;
  lane: LanePath;
  steps: AutomationStep[];
  automation: AutomationConfig;
  config: Config;
  selectedStep: (Selection & { kind: "step" }) | null;
  canEdit: boolean;
  onSelect: (selection: Selection) => void;
  onChangeSteps: (steps: AutomationStep[]) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.step.id,
    disabled: !props.canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "z-10 opacity-80")}
    >
      <StepCard {...props} dragHandle={{ ...attributes, ...listeners }} />
    </div>
  );
}

function StepCard({
  step,
  index,
  lane,
  steps,
  automation,
  config,
  selectedStep,
  canEdit,
  onSelect,
  onChangeSteps,
  dragHandle,
}: {
  step: AutomationStep;
  index: number;
  lane: LanePath;
  steps: AutomationStep[];
  automation: AutomationConfig;
  config: Config;
  selectedStep: (Selection & { kind: "step" }) | null;
  canEdit: boolean;
  onSelect: (selection: Selection) => void;
  onChangeSteps: (steps: AutomationStep[]) => void;
  dragHandle?: Record<string, unknown>;
}) {
  const Icon = STEP_ICONS[step.type];
  const { title, detail } = describeStep(step, config);
  const problem = stepIsIncomplete(step);
  const selected =
    selectedStep?.index === index && JSON.stringify(selectedStep.lane) === JSON.stringify(lane);

  return (
    <div
      className={cn(
        studioCard,
        "flex flex-col transition-colors",
        selected ? "border-zinc-600 bg-zinc-900" : "hover:border-zinc-700",
      )}
    >
      <div className="flex items-start gap-2 p-3">
        {canEdit && (
          <button
            type="button"
            className="mt-0.5 cursor-grab text-zinc-700 transition-colors hover:text-zinc-400 active:cursor-grabbing"
            aria-label={`Reorder ${title}`}
            {...dragHandle}
          >
            <GripVertical size={14} />
          </button>
        )}

        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          onClick={() => onSelect({ kind: "step", automationId: automation.id, lane, index })}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400">
            <Icon size={14} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium text-zinc-100">{title}</span>
            <span className="block truncate text-[11px] text-zinc-500">{detail}</span>
            {problem && (
              <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-500">
                <AlertTriangle size={11} aria-hidden="true" />
                {problem}
              </span>
            )}
          </span>
        </button>

        {canEdit && (
          <button
            type="button"
            className="mt-0.5 text-zinc-700 transition-colors hover:text-red-400"
            title={`Remove ${title}`}
            aria-label={`Remove ${title}`}
            onClick={() => onChangeSteps(removeStep(steps, lane, index))}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {step.type === "branch" && (
        <BranchPaths
          step={step}
          index={index}
          lane={lane}
          steps={steps}
          automation={automation}
          config={config}
          selectedStep={selectedStep}
          canEdit={canEdit}
          onSelect={onSelect}
          onChangeSteps={onChangeSteps}
        />
      )}
    </div>
  );
}

function BranchPaths({
  step,
  index,
  lane,
  steps,
  automation,
  config,
  selectedStep,
  canEdit,
  onSelect,
  onChangeSteps,
}: {
  step: AutomationStep & { type: "branch" };
  index: number;
  lane: LanePath;
  steps: AutomationStep[];
  automation: AutomationConfig;
  config: Config;
  selectedStep: (Selection & { kind: "step" }) | null;
  canEdit: boolean;
  onSelect: (selection: Selection) => void;
  onChangeSteps: (steps: AutomationStep[]) => void;
}) {
  const object = config.objects.find((candidate) => candidate.key === automation.trigger.objectKey);

  const updateBranch = (next: AutomationStep) => {
    const list = laneAt(steps, lane).map((entry, position) => (position === index ? next : entry));
    onChangeSteps(replaceLane(steps, lane, list));
  };

  return (
    <div className="border-t border-zinc-800/60 px-3 pb-3">
      {step.paths.map((path, pathIndex) => (
        <div key={path.id} className="mt-3 border-l border-zinc-800 pl-3">
          <div className="mb-2 flex items-center gap-2">
            <div className="max-w-[10rem] flex-1">
              <TextInput
                value={path.label}
                disabled={!canEdit}
                maxLength={60}
                onCommit={(label) =>
                  updateBranch({
                    ...step,
                    paths: step.paths.map((entry, position) =>
                      position === pathIndex ? { ...entry, label: label || entry.label } : entry,
                    ),
                  })
                }
              />
            </div>
            <span className="truncate text-[11px] text-zinc-600">
              {describeConditions(path.conditions, config)}
            </span>
            {canEdit && step.paths.length > 1 && (
              <button
                type="button"
                className="ml-auto shrink-0 text-[11px] text-zinc-600 transition-colors hover:text-red-400"
                onClick={() =>
                  updateBranch({
                    ...step,
                    paths: step.paths.filter((_, position) => position !== pathIndex),
                  })
                }
              >
                Remove path
              </button>
            )}
          </div>

          <div className="mb-2">
            <ConditionRows
              conditions={path.conditions}
              fields={object?.fields ?? []}
              disabled={!canEdit}
              onChange={(conditions) =>
                updateBranch({
                  ...step,
                  paths: step.paths.map((entry, position) =>
                    position === pathIndex ? { ...entry, conditions } : entry,
                  ),
                })
              }
            />
          </div>

          <StepLane
            steps={steps}
            lane={[...lane, index, pathIndex]}
            automation={automation}
            config={config}
            selectedStep={selectedStep}
            canEdit={canEdit}
            onSelect={onSelect}
            onChangeSteps={onChangeSteps}
            compact
          />
        </div>
      ))}

      {step.otherwise && (
        <div className="mt-3 border-l border-zinc-800 pl-3">
          <p className={cn(studioEyebrow, "mb-2")}>Otherwise</p>
          <StepLane
            steps={steps}
            lane={[...lane, index, OTHERWISE]}
            automation={automation}
            config={config}
            selectedStep={selectedStep}
            canEdit={canEdit}
            onSelect={onSelect}
            onChangeSteps={onChangeSteps}
            compact
          />
        </div>
      )}

      {canEdit && (
        <div className="mt-3 flex gap-3">
          {step.paths.length < 5 && (
            <button
              type="button"
              className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-200"
              onClick={() =>
                updateBranch({
                  ...step,
                  paths: [
                    ...step.paths,
                    { id: mintId("pth"), label: `Path ${step.paths.length + 1}`, conditions: [], steps: [] },
                  ],
                })
              }
            >
              Add a path
            </button>
          )}
          {!step.otherwise && (
            <button
              type="button"
              className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-200"
              onClick={() => updateBranch({ ...step, otherwise: [] })}
            >
              Add an otherwise path
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The "+" between steps                                                       */
/* -------------------------------------------------------------------------- */

function AddHere({
  onAdd,
  canEdit,
  last,
  compact,
}: {
  onAdd: (type: AutomationStep["type"]) => void;
  canEdit: boolean;
  objectKey: string;
  last?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  if (!canEdit) return <div className={compact ? "h-2" : "h-3"} />;

  return (
    <div className="relative flex flex-col items-center">
      <span className={cn("w-px bg-zinc-800", compact ? "h-2" : "h-3")} aria-hidden="true" />
      <button
        type="button"
        className={cn(
          "flex items-center gap-1.5 rounded-full border border-zinc-800 bg-[#131316] px-2 py-0.5 text-[11px] text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-200",
          !last && !open && "opacity-0 focus-visible:opacity-100 group-hover/lane:opacity-100 hover:opacity-100",
        )}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Plus size={11} aria-hidden="true" />
        {last ? "Add a step" : "Add"}
      </button>
      <span className={cn("w-px bg-zinc-800", compact ? "h-2" : "h-3")} aria-hidden="true" />

      {open && (
        <div className="absolute top-7 z-20 w-64 rounded-xl border border-zinc-800 bg-[#131316] p-1.5 shadow-2xl">
          <p className={cn(studioEyebrow, "px-2 py-1")}>Do something</p>
          {ACTION_TYPES.map((type) => (
            <StepChoice key={type} type={type} onPick={() => { setOpen(false); onAdd(type); }} />
          ))}
          <p className={cn(studioEyebrow, "px-2 py-1 pt-2")}>Control the run</p>
          {CONTROL_TYPES.map((type) => (
            <StepChoice key={type} type={type} onPick={() => { setOpen(false); onAdd(type); }} />
          ))}
        </div>
      )}
    </div>
  );
}

function StepChoice({ type, onPick }: { type: AutomationStep["type"]; onPick: () => void }) {
  const Icon = STEP_ICONS[type];
  return (
    <button
      type="button"
      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-zinc-900"
      onClick={onPick}
    >
      <Icon size={13} className="mt-0.5 shrink-0 text-zinc-500" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-xs text-zinc-200">{STEP_LABELS[type]}</span>
        <span className="block text-[11px] leading-snug text-zinc-600">{STEP_BLURBS[type]}</span>
      </span>
    </button>
  );
}

export { STEP_ICONS, Select };
