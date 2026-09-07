"use client";

import * as React from "react";
import * as kit from "./kit";
import { createRecord, updateRecord, useRecord, useRecords } from "./data";
import { formatValue } from "@/lib/runtime/field";
import type { Config, ObjectConfig } from "@/lib/config/types";

/**
 * Everything a coded screen can see.
 *
 * This object *is* the API. The compiled function is called with exactly these
 * names as its parameters, so what is not here is not in lexical reach —
 * there is no module registry to pull from and no import that could resolve.
 * Adding a capability to generated screens means adding a line here, which is
 * the point: the surface is enumerable and reviewable in one screen of code.
 *
 * Note what is absent: `fetch`, `window`, `document`, storage, and any way to
 * name a table or write a predicate. Records move only through the data client,
 * which the server compiles inside a tenant-scoped transaction.
 */
export interface ScreenContext {
  config: Config;
  /** The object a screen was built around, when it named one. */
  object?: ObjectConfig;
  onOpenRecord?: (recordId: string) => void;
  onAskAgent?: (prompt: string) => void;
}

export function buildScope(context: ScreenContext): Record<string, unknown> {
  const objects = Object.fromEntries(context.config.objects.map((object) => [object.key, object]));

  return {
    // The JSX pragma the compiler emits against.
    __jsx: React.createElement,
    __Fragment: React.Fragment,

    // React itself, plus the hooks by bare name — a model writes `useState`,
    // not `React.useState`, and correcting that in a prompt is a losing game.
    React,
    useState: React.useState,
    useEffect: React.useEffect,
    useMemo: React.useMemo,
    useCallback: React.useCallback,
    useRef: React.useRef,
    Fragment: React.Fragment,

    // The kit. Spread by name so a screen writes <Card> rather than <kit.Card>.
    ...kit,

    // Records.
    useRecords,
    useRecord,
    createRecord,
    updateRecord,
    formatValue,

    // What this workspace is made of, so a screen can read labels and options
    // rather than hardcoding a customer's own words into its markup.
    config: context.config,
    objects,
    object: context.object,

    // The two things a screen may ask the app to do.
    openRecord: context.onOpenRecord ?? (() => {}),
    askAgent: context.onAskAgent ?? (() => {}),
  };
}

/** The names above, for the prompt. Generated once so the two cannot drift. */
export function scopeNames(): string[] {
  return Object.keys(
    buildScope({ config: { objects: [] } as unknown as Config }),
  ).filter((name) => !name.startsWith("__"));
}
