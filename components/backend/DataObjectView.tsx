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
import { GripVertical, KeyRound, Lock, Plus } from "lucide-react";
import { FIELD_TYPE_LABELS, FIELD_TYPE_OPTIONS } from "@/lib/config/controls";
import { studioButtonSecondary, studioCard, studioEyebrow } from "@/components/builder/studio-chrome";
import { cn } from "@/lib/utils";
import { Select, TextInput } from "./controls";
import { keyFrom, mintId } from "./ids";
import type { Selection } from "./selection";
import type { Config, ConfigPatch, FieldConfig, FieldType, ObjectConfig } from "@/lib/config/types";

/**
 * The centre pane for a data object: its fields, in display order, editable in
 * place.
 *
 * Every row here is one patch — rename is `update_field`, drag is
 * `reorder_fields`, the button is `add_field`. None of that is new machinery:
 * the ops, the validation and the plain-English descriptions have all existed
 * since the agent shipped, and had no way to be reached except by asking it.
 */
export function DataObjectView({
  object,
  config,
  selection,
  canEdit,
  saving,
  onSelect,
  onCommit,
}: {
  object: ObjectConfig;
  config: Config;
  selection: Selection | null;
  canEdit: boolean;
  saving: boolean;
  onSelect: (selection: Selection) => void;
  onCommit: (patches: ConfigPatch[]) => void;
}) {
  const [adding, setAdding] = React.useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = object.fields.map((field) => field.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const next = [...ids];
    next.splice(to, 0, next.splice(from, 1)[0]!);
    onCommit([{ op: "reorder_fields", objectKey: object.key, fieldIds: next }]);
  };

  const relations = config.relations.filter(
    (relation) => relation.fromObject === object.key || relation.toObject === object.key,
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
      <header>
        <div className="max-w-xs">
          <TextInput
            value={object.labelPlural}
            disabled={!canEdit}
            maxLength={60}
            onCommit={(labelPlural) =>
              labelPlural.trim() &&
              onCommit([{ op: "update_object_label", objectKey: object.key, labelPlural: labelPlural.trim() }])
            }
          />
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-500">
          {object.fields.length} {object.fields.length === 1 ? "field" : "fields"} · records are stored as{" "}
          <code className="text-zinc-400">{object.key}</code>
        </p>
      </header>

      <section>
        <p className={cn(studioEyebrow, "mb-2")}>Fields</p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={object.fields.map((field) => field.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-1.5">
              {object.fields.map((field) => (
                <FieldRow
                  key={field.id}
                  field={field}
                  objectKey={object.key}
                  canEdit={canEdit}
                  selected={
                    selection?.kind === "field" &&
                    selection.fieldId === field.id &&
                    selection.objectKey === object.key
                  }
                  onSelect={() => onSelect({ kind: "field", objectKey: object.key, fieldId: field.id })}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {canEdit && !adding && (
          <button type="button" className={cn(studioButtonSecondary, "mt-3")} onClick={() => setAdding(true)}>
            <Plus size={13} aria-hidden="true" />
            Add field
          </button>
        )}

        {adding && (
          <AddField
            object={object}
            saving={saving}
            onCancel={() => setAdding(false)}
            onAdd={(field) => {
              setAdding(false);
              onCommit([{ op: "add_field", objectKey: object.key, field }]);
              onSelect({ kind: "field", objectKey: object.key, fieldId: field.id });
            }}
          />
        )}
      </section>

      <section>
        <p className={cn(studioEyebrow, "mb-2")}>Relationships</p>
        {relations.length === 0 ? (
          <p className="text-xs text-zinc-600">
            Nothing links to {object.labelPlural.toLowerCase()} yet. Ask the agent to connect them, or add a
            related-record field.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {relations.map((relation) => (
              <li key={relation.key} className={cn(studioCard, "px-3 py-2 text-xs text-zinc-300")}>
                {relation.label}
                <span className="ml-2 text-[11px] text-zinc-600">
                  {relation.fromObject} → {relation.toObject} ·{" "}
                  {relation.kind === "many_to_many" ? "many to many" : "one to many"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FieldRow({
  field,
  objectKey,
  canEdit,
  selected,
  onSelect,
}: {
  field: FieldConfig;
  objectKey: string;
  canEdit: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
    disabled: !canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        studioCard,
        "flex items-center gap-2 px-2.5 py-2 transition-colors",
        selected ? "border-zinc-600 bg-zinc-900" : "hover:border-zinc-700",
        isDragging && "z-10 opacity-80",
      )}
    >
      {canEdit && (
        <button
          type="button"
          className="cursor-grab text-zinc-700 transition-colors hover:text-zinc-400 active:cursor-grabbing"
          aria-label={`Reorder ${field.label}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
      )}

      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onSelect}>
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-100">{field.label}</span>
        {field.required && <span className="shrink-0 text-[11px] text-zinc-500">required</span>}
        {field.system && (
          <span className="shrink-0 text-zinc-600" title="Built in — the product depends on this field">
            <Lock size={11} aria-hidden="true" />
          </span>
        )}
        {field.type === "relation" && (
          <span className="shrink-0 text-zinc-600" title="Links to another record">
            <KeyRound size={11} aria-hidden="true" />
          </span>
        )}
        <span className="shrink-0 font-mono text-[10px] text-zinc-600">
          {FIELD_TYPE_LABELS[field.type] ?? field.type}
        </span>
      </button>
      <span className="sr-only">{objectKey}</span>
    </div>
  );
}

function AddField({
  object,
  saving,
  onAdd,
  onCancel,
}: {
  object: ObjectConfig;
  saving: boolean;
  onAdd: (field: FieldConfig) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = React.useState("");
  const [type, setType] = React.useState<FieldType>("text");

  const needsOptions = type === "select" || type === "multi_select";
  const ready = label.trim().length > 0 && type !== "relation";

  return (
    <div className={cn(studioCard, "mt-3 flex flex-col gap-2 p-3")}>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-medium text-zinc-400" htmlFor="new-field-label">
          Name
        </label>
        <input
          id="new-field-label"
          autoFocus
          className="w-full rounded-lg border border-zinc-800 bg-[#131316] px-2.5 py-1.5 text-xs text-zinc-100 focus:border-zinc-600 focus:outline-none"
          value={label}
          maxLength={80}
          placeholder="Renewal date"
          onChange={(event) => setLabel(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-medium text-zinc-400">Type</label>
        <Select
          value={type}
          options={FIELD_TYPE_OPTIONS.filter((option) => option.value !== "relation")}
          onCommit={(next) => setType((next ?? "text") as FieldType)}
        />
        <p className="text-[11px] text-zinc-600">
          A field&apos;s type cannot be changed later — that is a data migration, not a setting.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className={studioButtonSecondary}
          disabled={!ready || saving}
          onClick={() =>
            onAdd({
              id: mintId("fld"),
              key: keyFrom(label, object.fields.map((field) => field.key)),
              label: label.trim(),
              type,
              required: false,
              system: false,
              ...(needsOptions
                ? { options: [{ value: "option_1", label: "Option 1" }] }
                : {}),
            })
          }
        >
          Add field
        </button>
        <button type="button" className={studioButtonSecondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
