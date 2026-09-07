import { findObject } from "@/lib/config/patch";
import type {
  Config,
  FieldConfig,
  LayoutConfig,
  ObjectConfig,
  PipelineConfig,
  ViewConfig,
} from "@/lib/config/types";

/**
 * The view resolver: view config to a renderer choice plus its props. The
 * output is always one of the components in docs/COMPONENTS.md — if a view
 * needs something else, the config schema is missing something, and the fix
 * goes there rather than here.
 */

export class ViewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ViewError";
  }
}

export type ResolvedView =
  | {
      renderer: "table";
      view: ViewConfig;
      object: ObjectConfig;
      columns: FieldConfig[];
    }
  | {
      renderer: "kanban";
      view: ViewConfig;
      object: ObjectConfig;
      pipeline: PipelineConfig;
      stageField: FieldConfig;
      /** Cards show the view's first three columns. */
      cardFields: FieldConfig[];
      /** Summed per column when the view carries a currency field. */
      sumField?: FieldConfig;
    }
  | {
      renderer: "detail";
      view: ViewConfig;
      object: ObjectConfig;
      layout: LayoutConfig;
      fields: FieldConfig[];
    };

export function resolveView(config: Config, viewId: string): ResolvedView {
  const view = config.views.find((v) => v.id === viewId);
  if (!view) throw new ViewError(`There is no view ${viewId}`);
  return resolveViewConfig(config, view);
}

export function resolveViewConfig(config: Config, view: ViewConfig): ResolvedView {
  const object = findObject(config, view.objectKey);
  if (!object) throw new ViewError(`The ${view.name} view points at an object that no longer exists`);

  const byId = new Map(object.fields.map((field) => [field.id, field]));
  const columns = view.columns
    .map((id) => byId.get(id))
    .filter((field): field is FieldConfig => Boolean(field));

  switch (view.renderer) {
    case "table":
      return { renderer: "table", view, object, columns };

    case "kanban": {
      if (!view.pipelineId) throw new ViewError(`The ${view.name} board has no pipeline`);
      const pipeline = config.pipelines.find((p) => p.id === view.pipelineId);
      if (!pipeline) throw new ViewError(`The ${view.name} board points at a pipeline that no longer exists`);
      const stageField = byId.get(pipeline.stageFieldId);
      if (!stageField) throw new ViewError(`The ${pipeline.name} pipeline has no stage field`);

      return {
        renderer: "kanban",
        view,
        object,
        pipeline,
        stageField,
        cardFields: columns.slice(0, 3),
        sumField: columns.find((field) => field.type === "currency"),
      };
    }

    case "detail":
      return {
        renderer: "detail",
        view,
        object,
        layout: object.layout,
        fields: columns.length > 0 ? columns : object.fields,
      };
  }
}

/** Groups a record's fields for RecordDetail, with anything ungrouped last. */
export function resolveLayout(object: ObjectConfig): { label: string; fields: FieldConfig[] }[] {
  const byId = new Map(object.fields.map((field) => [field.id, field]));
  const placed = new Set<string>();

  const groups = object.layout.groups.map((group) => {
    const fields = group.fieldIds
      .map((id) => byId.get(id))
      .filter((field): field is FieldConfig => Boolean(field));
    for (const field of fields) placed.add(field.id);
    return { label: group.label, fields };
  });

  const rest = object.fields.filter((field) => !placed.has(field.id));
  if (rest.length > 0) groups.push({ label: "Other", fields: rest });

  return groups.filter((group) => group.fields.length > 0);
}

export function viewsForObject(config: Config, objectKey: string): ViewConfig[] {
  return config.views.filter((view) => view.objectKey === objectKey);
}
