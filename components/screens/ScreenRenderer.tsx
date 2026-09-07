"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search as SearchIcon, Plus, Sparkles } from "lucide-react";
import type { Config, CrmRecord, FieldConfig, ScreenConfig, ThemeConfig, UiNode } from "@/lib/config/types";
import { formatValue } from "@/lib/runtime/field";
import { resolveTheme } from "@/lib/config/theme";
import { FieldRenderer } from "@/components/renderers/FieldRenderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createRecordAction } from "@/app/(app)/actions";
import { cn } from "@/lib/utils";
import {
  badgeSkin,
  buttonSkin,
  cardSkin,
  COLS,
  has,
  inputSkin,
  panelSkin,
  styleClasses,
  tableSkin,
  tabsSkin,
} from "./style";

/**
 * The interpreter for a generated screen.
 *
 * This is not a view renderer, and there is no inventory of screens: the agent
 * composes a tree out of primitives and this draws whatever it composed. A board
 * beside a form inside a panel is as valid as a full-width table, because
 * nothing here knows what a "screen" is meant to look like.
 *
 * Nor does it know what a screen should look like. Every visual decision comes
 * from the tenant's theme — the component variant for tables, cards, tabs,
 * buttons and badges, and the tokens behind every colour, size and space. What
 * is hardcoded here is structure: a table has a header and rows, a board has a
 * column per stage. How those read is the theme's business.
 */

export interface ScreenData {
  lists: Record<string, { records: CrmRecord[]; total: number }>;
  metrics: Record<string, number | null>;
  titles: Record<string, string>;
}

interface RenderContext {
  config: Config;
  theme: ThemeConfig;
  data: ScreenData;
  titles: Record<string, string>;
  /** Search text and filter state live per screen, not per node. */
  search: string;
  setSearch: (value: string) => void;
  onAskAgent?: (prompt: string) => void;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function objectFor(config: Config, key?: string) {
  return config.objects.find((candidate) => candidate.key === key);
}

function fieldsByIds(config: Config, objectKey: string | undefined, ids: string[] | undefined): FieldConfig[] {
  const object = objectFor(config, objectKey);
  if (!object) return [];
  if (!ids || ids.length === 0) return object.fields.slice(0, 6);
  return ids.map((id) => object.fields.find((field) => field.id === id)).filter((f): f is FieldConfig => Boolean(f));
}

function titleOf(config: Config, record: CrmRecord, titles: Record<string, string>): string {
  const object = objectFor(config, record.objectKey);
  const titleField = object?.fields.find((field) => field.id === object.titleFieldId) ?? object?.fields[0];
  const raw = titleField ? record.data[titleField.id] : undefined;
  return raw ? String(raw) : (titles[record.id] ?? "Untitled");
}

/** Free-text match across whatever the screen is showing. */
function matchesSearch(record: CrmRecord, term: string): boolean {
  if (!term.trim()) return true;
  const needle = term.trim().toLowerCase();
  return Object.values(record.data).some((value) => String(value ?? "").toLowerCase().includes(needle));
}

function EmptyState({ label, node }: { label: string; node: UiNode }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded border border-dashed border-edge px-4 py-6 text-center",
        styleClasses(node),
      )}
    >
      <p className="text-sm text-content-muted">{label}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Data nodes                                                                  */
/* -------------------------------------------------------------------------- */

function TableNode({ node, path, ctx }: { node: UiNode; path: string; ctx: RenderContext }) {
  const router = useRouter();
  const skin = tableSkin(ctx.theme, node.style?.variant);
  const list = ctx.data.lists[path];
  const fields = fieldsByIds(ctx.config, node.query?.objectKey, node.columns);
  const object = objectFor(ctx.config, node.query?.objectKey);

  const rows = (list?.records ?? []).filter((record) => matchesSearch(record, ctx.search));
  if (rows.length === 0) {
    return <EmptyState node={node} label={`No ${object?.labelPlural.toLowerCase() ?? "records"} yet`} />;
  }

  // The cards variant is a different structure, not a different skin.
  if (skin.asCards) {
    return (
      <div className={cn(skin.wrapper, styleClasses(node))}>
        {rows.map((record) => (
          <button
            key={record.id}
            type="button"
            onClick={() => router.push(`/records/${record.id}`)}
            className={cn("w-full text-left transition", skin.row)}
          >
            <p className="font-medium text-content">{titleOf(ctx.config, record, ctx.titles)}</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {fields.slice(1).map((field) => (
                <span key={field.id} className="text-sm text-content-muted">
                  {formatValue(field, record.data[field.id], { labelFor: (id) => ctx.titles[id] })}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn(skin.wrapper, styleClasses(node))}>
      <table className="w-full border-collapse">
        <thead className={skin.head}>
          <tr>
            {fields.map((field) => (
              <th key={field.id} className={cn(skin.headCell, "whitespace-nowrap text-sm")}>
                {field.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((record) => (
            <tr
              key={record.id}
              onClick={() => router.push(`/records/${record.id}`)}
              className={cn("cursor-pointer", skin.row)}
            >
              {fields.map((field) => (
                <td key={field.id} className={cn("h-row align-middle text-sm", skin.cell)}>
                  <FieldRenderer
                    field={field}
                    value={record.data[field.id]}
                    mode="read"
                    lookup={{ labelFor: (id) => ctx.titles[id] }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoardNode({ node, path, ctx }: { node: UiNode; path: string; ctx: RenderContext }) {
  const router = useRouter();
  const list = ctx.data.lists[path];
  const pipeline = ctx.config.pipelines.find((candidate) => candidate.id === node.pipelineId);
  if (!pipeline) return <EmptyState node={node} label="That pipeline no longer exists" />;

  const rows = (list?.records ?? []).filter((record) => matchesSearch(record, ctx.search));
  const cardFields = fieldsByIds(ctx.config, node.query?.objectKey, node.columns).slice(0, 3);
  const card = cardSkin(ctx.theme, node.style?.variant);

  return (
    <div className={cn("flex overflow-x-auto pb-1", has(node, "gap") ? "" : "gap-3", styleClasses(node))}>
      {pipeline.stages.map((stage) => {
        const cards = rows.filter((record) => record.data[pipeline.stageFieldId] === stage.key);
        return (
          <div key={stage.key} className={cn("flex shrink-0 flex-col gap-2", node.style?.width ? "" : "w-72")}>
            <div className="flex items-center justify-between px-1">
              <span className="text-sm font-medium text-content-secondary">{stage.label}</span>
              <span className="text-sm tabular-nums text-content-muted">{cards.length}</span>
            </div>
            <div className={cn("flex min-h-24 flex-col gap-2 rounded bg-surface-sunken p-2")}>
              {cards.map((record) => (
                <button
                  key={record.id}
                  type="button"
                  onClick={() => router.push(`/records/${record.id}`)}
                  className={cn("p-2 text-left transition hover:border-edge-strong", card)}
                >
                  <p className="text-sm font-medium text-content">{titleOf(ctx.config, record, ctx.titles)}</p>
                  {cardFields.map((field) => {
                    const value = record.data[field.id];
                    if (value === undefined || value === null || value === "") return null;
                    return (
                      <p key={field.id} className="mt-0.5 text-sm text-content-muted">
                        {formatValue(field, value, { labelFor: (id) => ctx.titles[id] })}
                      </p>
                    );
                  })}
                </button>
              ))}
              {cards.length === 0 && <p className="px-1 py-2 text-sm text-content-muted">Empty</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListNode({ node, path, ctx }: { node: UiNode; path: string; ctx: RenderContext }) {
  const router = useRouter();
  const list = ctx.data.lists[path];
  const rows = (list?.records ?? []).filter((record) => matchesSearch(record, ctx.search));
  const detail = fieldsByIds(ctx.config, node.query?.objectKey, node.columns).slice(0, 2);

  if (rows.length === 0) return <EmptyState node={node} label="Nothing here yet" />;

  return (
    <div className={cn("flex flex-col divide-y divide-edge", cardSkin(ctx.theme, node.style?.variant), styleClasses(node))}>
      {rows.map((record) => (
        <button
          key={record.id}
          type="button"
          onClick={() => router.push(`/records/${record.id}`)}
          className="flex items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-surface-hover"
        >
          <span className="truncate text-sm text-content">{titleOf(ctx.config, record, ctx.titles)}</span>
          <span className="flex shrink-0 items-center gap-2">
            {detail.map((field) => {
              const value = record.data[field.id];
              if (value === undefined || value === null || value === "") return null;
              return (
                <span key={field.id} className="text-sm text-content-muted">
                  {formatValue(field, value, { labelFor: (id) => ctx.titles[id] })}
                </span>
              );
            })}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Grouped counts, drawn with CSS. No charting dependency. */
function ChartNode({ node, path, ctx }: { node: UiNode; path: string; ctx: RenderContext }) {
  const list = ctx.data.lists[path];
  const object = objectFor(ctx.config, node.query?.objectKey);
  const field = object?.fields.find((candidate) => candidate.id === node.groupBy);

  if (!field) return <EmptyState node={node} label="This chart has nothing to group by" />;

  const buckets = new Map<string, number>();
  for (const record of list?.records ?? []) {
    const raw = record.data[field.id];
    const key = raw === undefined || raw === null || raw === "" ? "—" : String(raw);
    const label = field.options?.find((option) => option.value === key)?.label ?? key;
    buckets.set(label, (buckets.get(label) ?? 0) + 1);
  }

  const entries = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = Math.max(1, ...entries.map(([, count]) => count));

  if (entries.length === 0) return <EmptyState node={node} label="No data to chart yet" />;

  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  // A donut is a different shape of the same data, and the schema has always
  // offered it. It used to render bars regardless.
  if (node.chartType === "donut") {
    let offset = 0;
    const ring = entries
      .map(([, count], index) => {
        const share = (count / total) * 100;
        const slice = `var(--accent) ${offset}% ${offset + share}%`;
        offset += share;
        return index % 2 === 0 ? slice : `var(--accent-hover) ${offset - share}% ${offset}%`;
      })
      .join(", ");

    return (
      <div className={cn("flex items-center gap-4", styleClasses(node))}>
        <div
          className="h-28 w-28 shrink-0 rounded-full"
          style={{ background: `conic-gradient(${ring})`, mask: "radial-gradient(circle, transparent 55%, black 56%)", WebkitMask: "radial-gradient(circle, transparent 55%, black 56%)" }}
        />
        <div className="flex min-w-0 flex-col gap-1">
          {entries.map(([label, count]) => (
            <div key={label} className="flex items-center gap-2 text-sm">
              <span className="truncate text-content-secondary">{label}</span>
              <span className="tabular-nums text-content-muted">{count}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", has(node, "gap") ? "" : "gap-1.5", styleClasses(node))}>
      {entries.map(([label, count]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-sm text-content-secondary">{label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded bg-surface-sunken">
            <div className="h-full rounded bg-accent" style={{ width: `${(count / max) * 100}%` }} />
          </div>
          <span className="w-8 shrink-0 text-right text-sm tabular-nums text-content-muted">{count}</span>
        </div>
      ))}
    </div>
  );
}

function MetricNode({ node, path, ctx }: { node: UiNode; path: string; ctx: RenderContext }) {
  const value = ctx.data.metrics[path];
  const aggregate = node.aggregate;
  const field = aggregate?.fieldId
    ? objectFor(ctx.config, aggregate.objectKey)?.fields.find((f) => f.id === aggregate.fieldId)
    : undefined;

  const display =
    value === null || value === undefined
      ? "—"
      : field && (field.type === "currency" || field.type === "number")
        ? formatValue(field, value, {})
        : Number.isInteger(value)
          ? value.toLocaleString()
          : value.toFixed(1);

  return (
    <div
      className={cn(
        "flex flex-col gap-0.5",
        cardSkin(ctx.theme, node.style?.variant),
        has(node, "pad") ? "" : "p-3",
        styleClasses(node),
      )}
    >
      <span className="text-sm text-content-muted">{node.label ?? node.text ?? "Metric"}</span>
      <span
        className={cn(
          "font-display tabular-nums text-content",
          has(node, "size") ? "" : "text-xl",
          has(node, "weight") ? "" : "font-semibold",
        )}
      >
        {display}
      </span>
    </div>
  );
}

function FormNode({ node, ctx }: { node: UiNode; ctx: RenderContext }) {
  const router = useRouter();
  const object = objectFor(ctx.config, node.objectKey);
  const fields = fieldsByIds(ctx.config, node.objectKey, node.fields);
  const button = buttonSkin(ctx.theme);

  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!object) return <EmptyState node={node} label="That object no longer exists" />;

  const submit = async () => {
    setSaving(true);
    setError(null);
    const result = await createRecordAction(object.key, values);
    setSaving(false);
    if ("ok" in result) {
      setValues({});
      router.refresh();
    } else {
      setError(result.message);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        cardSkin(ctx.theme, node.style?.variant),
        has(node, "pad") ? "" : "p-3",
        styleClasses(node),
      )}
    >
      {node.label && <p className="text-sm font-medium text-content">{node.label}</p>}
      {fields.map((field) => (
        <label key={field.id} className="flex flex-col gap-1">
          <span className="text-sm text-content-secondary">{field.label}</span>
          <FieldRenderer
            field={field}
            value={values[field.id]}
            mode="edit"
            className={inputSkin(ctx.theme)}
            onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
          />
        </label>
      ))}
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <Button
        type="button"
        size="sm"
        variant={button.variant}
        className={button.className}
        onClick={() => void submit()}
        disabled={saving}
      >
        {saving ? "Saving…" : `Add ${object.label.toLowerCase()}`}
      </Button>
    </div>
  );
}

function RecordDetailNode({ node, ctx }: { node: UiNode; ctx: RenderContext }) {
  const object = objectFor(ctx.config, node.objectKey);
  const fields = fieldsByIds(ctx.config, node.objectKey, node.fields);
  if (!object) return <EmptyState node={node} label="That object no longer exists" />;

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        cardSkin(ctx.theme, node.style?.variant),
        has(node, "pad") ? "" : "p-3",
        styleClasses(node),
      )}
    >
      <p className="text-sm font-medium text-content">{node.label ?? object.label}</p>
      <dl className="flex flex-col gap-1.5">
        {fields.map((field) => (
          <div key={field.id} className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-content-muted">{field.label}</dt>
            <dd className="text-sm text-content">{field.type}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The interpreter                                                             */
/* -------------------------------------------------------------------------- */

function Node({ node, path, ctx }: { node: UiNode; path: string; ctx: RenderContext }) {
  const router = useRouter();
  const children = node.children ?? [];

  const renderChildren = () =>
    children.map((child, index) => (
      <Node key={index} node={child} path={`${path}.children.${index}`} ctx={ctx} />
    ));

  switch (node.kind) {
    case "stack":
      return (
        <div
          className={cn(
            "flex min-w-0",
            node.direction === "row" ? "flex-row" : "flex-col",
            has(node, "gap") ? "" : "gap-3",
            styleClasses(node),
          )}
        >
          {renderChildren()}
        </div>
      );

    case "grid":
      return (
        <div
          className={cn("grid min-w-0", COLS[node.cols ?? 3], has(node, "gap") ? "" : "gap-3", styleClasses(node))}
        >
          {renderChildren()}
        </div>
      );

    case "card":
      return (
        <div
          className={cn(
            "flex min-w-0 flex-col",
            cardSkin(ctx.theme, node.style?.variant),
            has(node, "pad") ? "" : "p-3",
            has(node, "gap") ? "" : "gap-2",
            styleClasses(node),
          )}
        >
          {node.label && <p className="text-sm font-medium text-content">{node.label}</p>}
          {renderChildren()}
        </div>
      );

    case "section":
      return (
        <section className={cn("flex min-w-0 flex-col", has(node, "gap") ? "" : "gap-2", styleClasses(node))}>
          {node.label && (
            <h2
              className={cn(
                "font-display text-content-secondary",
                has(node, "size") ? "" : "text-sm",
                has(node, "weight") ? "" : "font-semibold",
                // All-caps section headings are an editorial choice now, not the
                // house style docs/DESIGN.md warns against.
                ctx.theme.type.uppercaseHeadings && !has(node, "uppercase") && "uppercase tracking-theme",
              )}
            >
              {node.label}
            </h2>
          )}
          {renderChildren()}
        </section>
      );

    case "panel":
      return (
        <aside
          className={cn(
            "flex shrink-0 flex-col",
            panelSkin(ctx.theme, node.style?.variant),
            node.style?.width ? "" : "w-72",
            has(node, "pad") ? "" : "p-3",
            has(node, "gap") ? "" : "gap-2",
            node.side === "left" ? "order-first" : "order-last",
            styleClasses(node),
          )}
        >
          {node.label && <p className="text-sm font-medium text-content">{node.label}</p>}
          {renderChildren()}
        </aside>
      );

    case "tabs":
      return <TabsNode node={node} path={path} ctx={ctx} />;

    case "tab":
      return (
        <div className={cn("flex flex-col", has(node, "gap") ? "" : "gap-3", styleClasses(node))}>
          {renderChildren()}
        </div>
      );

    case "divider":
      return <hr className={cn("border-edge", styleClasses(node))} />;

    case "spacer":
      return <div className={cn(has(node, "pad") ? "" : "h-3", styleClasses(node))} />;

    case "heading":
      return (
        <h1
          className={cn(
            "font-display text-content",
            has(node, "size") ? "" : "text-lg",
            has(node, "weight") ? "" : "font-semibold",
            styleClasses(node),
          )}
        >
          {node.text ?? node.label}
        </h1>
      );

    case "text":
      return (
        <p className={cn("text-content-secondary", has(node, "size") ? "" : "text-sm", styleClasses(node))}>
          {node.text}
        </p>
      );

    case "badge": {
      // `tone` used to be discarded here, so every badge rendered neutral.
      const tone = node.style?.tone;
      const badgeTone =
        tone === "success" || tone === "danger" || tone === "warning" ? tone : "neutral";
      return (
        <Badge
          tone={badgeTone}
          className={cn(badgeSkin(ctx.theme, node.style?.variant), styleClasses(node))}
        >
          {node.text ?? node.label}
        </Badge>
      );
    }

    case "metric":
      return <MetricNode node={node} path={path} ctx={ctx} />;

    case "table":
      return <TableNode node={node} path={path} ctx={ctx} />;

    case "board":
      return <BoardNode node={node} path={path} ctx={ctx} />;

    case "list":
      return <ListNode node={node} path={path} ctx={ctx} />;

    case "chart":
      return <ChartNode node={node} path={path} ctx={ctx} />;

    case "form":
      return <FormNode node={node} ctx={ctx} />;

    case "record_detail":
      return <RecordDetailNode node={node} ctx={ctx} />;

    case "search":
      return (
        <div className={cn("relative", styleClasses(node))}>
          <SearchIcon size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-content-muted" />
          <Input
            value={ctx.search}
            onChange={(event) => ctx.setSearch(event.target.value)}
            placeholder={node.label ?? "Search"}
            className={cn("pl-8 text-sm", inputSkin(ctx.theme, node.style?.variant))}
          />
        </div>
      );

    case "filters":
      // Filters the agent set are already in the query; this is the user's own
      // narrowing, which for now is the same free-text match the search uses.
      return (
        <div className={cn("flex items-center gap-2 text-sm text-content-muted", styleClasses(node))}>
          <span>{node.label ?? "Filter"}</span>
          <Input
            value={ctx.search}
            onChange={(event) => ctx.setSearch(event.target.value)}
            placeholder="Type to narrow"
            className={cn("w-48 text-sm", inputSkin(ctx.theme, node.style?.variant))}
          />
        </div>
      );

    case "button": {
      const action = node.action;
      const skin = buttonSkin(ctx.theme, node.style?.variant);
      const onClick = () => {
        if (!action) return;
        if (action.type === "open_screen") router.push(`/screens/${action.screenId}`);
        if (action.type === "open_record" && action.recordId) router.push(`/records/${action.recordId}`);
        if (action.type === "ask_agent") ctx.onAskAgent?.(action.prompt);
        if (action.type === "create_record") ctx.onAskAgent?.(`Add a ${action.objectKey}`);
      };
      return (
        <Button
          type="button"
          size={node.style?.size === "sm" ? "sm" : "default"}
          variant={skin.variant}
          onClick={onClick}
          className={cn("w-fit gap-2 text-sm font-medium", skin.className, styleClasses(node))}
        >
          {action?.type === "create_record" && <Plus size={15} />}
          {action?.type === "ask_agent" && <Sparkles size={15} />}
          {node.label ?? node.text ?? "Action"}
        </Button>
      );
    }

    default:
      return null;
  }
}

function TabsNode({ node, path, ctx }: { node: UiNode; path: string; ctx: RenderContext }) {
  const [active, setActive] = React.useState(0);
  const tabs = node.children ?? [];
  const skin = tabsSkin(ctx.theme, node.style?.variant);

  return (
    <div className={cn("flex flex-col", has(node, "gap") ? "" : "gap-2", styleClasses(node))}>
      <div className={skin.list}>
        {tabs.map((tab, index) => (
          <button
            key={index}
            type="button"
            onClick={() => setActive(index)}
            className={cn("text-sm", skin.tab, index === active && skin.active)}
          >
            {tab.label ?? `Tab ${index + 1}`}
          </button>
        ))}
      </div>
      {tabs[active] && <Node node={tabs[active]!} path={`${path}.children.${active}`} ctx={ctx} />}
    </div>
  );
}

export function ScreenRenderer({
  screen,
  config,
  data,
  onAskAgent,
}: {
  screen: ScreenConfig;
  config: Config;
  data: ScreenData;
  onAskAgent?: (prompt: string) => void;
}) {
  const [search, setSearch] = React.useState("");
  const theme = React.useMemo(() => resolveTheme(config.theme), [config.theme]);

  const ctx: RenderContext = {
    config,
    theme,
    data,
    titles: data.titles,
    search,
    setSearch,
    onAskAgent,
  };

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-auto p-4">
      {screen.root && <Node node={screen.root} path="root" ctx={ctx} />}
    </div>
  );
}
