"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Database } from "lucide-react";
import { FIELD_TYPE_LABELS } from "@/lib/config/controls";
import { cn } from "@/lib/utils";
import type { Config, ObjectConfig } from "@/lib/config/types";

/**
 * The data model as a picture: one card per object, one line per relation.
 *
 * This replaces a hand-rolled canvas whose wire endpoints were guessed from
 * magic constants (`headerH`, `28`, `14`) and were already wrong for collapsed
 * nodes. A layout engine measures its own handles, so the lines land where the
 * fields are.
 *
 * It is a map, not an editor — clicking a card selects the object, and the
 * editing happens in the pane beside it. Relations are still the agent's to
 * create; dragging one into existence is a later change, and a lie until the
 * patch behind it exists.
 */

interface ObjectNodeData extends Record<string, unknown> {
  object: ObjectConfig;
  selected: boolean;
}

function ObjectNode({ data }: NodeProps<Node<ObjectNodeData>>) {
  const { object, selected } = data;
  const shown = object.fields.slice(0, 7);

  return (
    <div
      className={cn(
        "w-56 overflow-hidden rounded-xl border bg-[#131316] shadow-sm transition-colors",
        selected ? "border-zinc-500" : "border-zinc-800",
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-zinc-600" />
      <div className="flex items-center gap-2 border-b border-zinc-800/80 bg-[#18181c] px-2.5 py-2">
        <Database size={12} className="shrink-0 text-zinc-500" aria-hidden="true" />
        <span className="truncate text-xs font-medium text-zinc-100">{object.labelPlural}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-600">{object.fields.length}</span>
      </div>
      <ul className="flex flex-col">
        {shown.map((field) => (
          <li key={field.id} className="flex items-center gap-2 px-2.5 py-1">
            <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{field.label}</span>
            <span className="shrink-0 font-mono text-[10px] text-zinc-600">
              {FIELD_TYPE_LABELS[field.type] ?? field.type}
            </span>
          </li>
        ))}
        {object.fields.length > shown.length && (
          <li className="px-2.5 py-1 text-[11px] text-zinc-600">
            and {object.fields.length - shown.length} more
          </li>
        )}
      </ul>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-zinc-600" />
    </div>
  );
}

const nodeTypes = { object: ObjectNode };

export function DataMap({
  config,
  selectedObjectKey,
  onSelectObject,
}: {
  config: Config;
  selectedObjectKey?: string;
  onSelectObject: (objectKey: string) => void;
}) {
  const nodes: Node<ObjectNodeData>[] = React.useMemo(
    () =>
      config.objects.map((object, index) => ({
        id: object.key,
        type: "object",
        position: { x: (index % 2) * 340, y: Math.floor(index / 2) * 300 },
        data: { object, selected: object.key === selectedObjectKey },
      })),
    [config.objects, selectedObjectKey],
  );

  const edges: Edge[] = React.useMemo(
    () =>
      config.relations
        .filter((relation) =>
          config.objects.some((object) => object.key === relation.fromObject) &&
          config.objects.some((object) => object.key === relation.toObject),
        )
        .map((relation) => ({
          id: relation.key,
          source: relation.fromObject,
          target: relation.toObject,
          label: relation.label,
          animated: false,
          style: { stroke: "#3f3f46" },
          labelStyle: { fill: "#a1a1aa", fontSize: 10 },
          labelBgStyle: { fill: "#131316" },
        })),
    [config.relations, config.objects],
  );

  return (
    <div className="h-full min-h-0 w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={(_event, node) => onSelectObject(node.id)}
        className="bg-[#09090b]"
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#27272a" />
        <Controls showInteractive={false} className="!border-zinc-800 !bg-[#131316]" />
      </ReactFlow>
    </div>
  );
}
