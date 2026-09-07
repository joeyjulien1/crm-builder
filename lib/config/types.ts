import type { z } from "zod";
import type {
  actionSchema,
  automationConfigSchema,
  brandConfigSchema,
  configSchema,
  customAgentConfigSchema,
  fieldConfigSchema,
  fieldTypeSchema,
  filterConditionSchema,
  filterGroupSchema,
  filterTreeSchema,
  layoutConfigSchema,
  objectConfigSchema,
  objectKeySchema,
  operatorSchema,
  pipelineConfigSchema,
  pipelineStageSchema,
  relationConfigSchema,
  rendererSchema,
  selectOptionSchema,
  screenConfigSchema,
  sortSchema,
  themeConfigSchema,
  triggerSchema,
  viewConfigSchema,
} from "./schema";
import type { configPatchSchema } from "./patch";

/** Every config type is inferred. None of these are hand-written. */
export type Config = z.infer<typeof configSchema>;
export type BrandConfig = z.infer<typeof brandConfigSchema>;
export type ThemeConfig = z.infer<typeof themeConfigSchema>;
export type ScreenConfig = z.infer<typeof screenConfigSchema>;
export type CustomAgentConfig = z.infer<typeof customAgentConfigSchema>;
export type ObjectConfig = z.infer<typeof objectConfigSchema>;
export type ObjectKey = z.infer<typeof objectKeySchema>;
export type FieldConfig = z.infer<typeof fieldConfigSchema>;
export type FieldType = z.infer<typeof fieldTypeSchema>;
export type SelectOption = z.infer<typeof selectOptionSchema>;
export type ViewConfig = z.infer<typeof viewConfigSchema>;
export type Renderer = z.infer<typeof rendererSchema>;
export type LayoutConfig = z.infer<typeof layoutConfigSchema>;
export type PipelineConfig = z.infer<typeof pipelineConfigSchema>;
export type PipelineStage = z.infer<typeof pipelineStageSchema>;
export type RelationConfig = z.infer<typeof relationConfigSchema>;
export type AutomationConfig = z.infer<typeof automationConfigSchema>;
export type AutomationTrigger = z.infer<typeof triggerSchema>;
export type AutomationAction = z.infer<typeof actionSchema>;
/** A workflow's ordered program. Recursive, so it comes from the schema module. */
export type { AutomationStep, BranchStep, BranchPath, StepType } from "./schema";
export type FilterCondition = z.infer<typeof filterConditionSchema>;
export type FilterGroup = z.infer<typeof filterGroupSchema>;
export type FilterTree = z.infer<typeof filterTreeSchema>;
export type FilterOperator = z.infer<typeof operatorSchema>;
export type Sort = z.infer<typeof sortSchema>;
export type ConfigPatch = z.infer<typeof configPatchSchema>;

/** A stored record. `data` is keyed by field id, never by field key. */
export interface CrmRecord {
  id: string;
  objectKey: ObjectKey;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ImpactSummary {
  /** One entry per patch, in patch order. */
  items: ImpactItem[];
  hasDestructive: boolean;
  hasExternalEffects: boolean;
}

export interface ImpactItem {
  /** Plain language, as shown in ConfigDiff. Never JSON. */
  description: string;
  destructive: boolean;
  externalEffect: boolean;
  /** How many records hold a value that this change would drop. */
  affectedRecords?: number;
}

/** Recursive, so it comes from the schema module rather than being inferred. */
export type { UiNode } from "./schema";
