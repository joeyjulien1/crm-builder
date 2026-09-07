"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ScreenRenderer } from "./ScreenRenderer";
import { GeneratedScreen } from "@/components/generated/GeneratedScreen";
import type { Config, ScreenConfig } from "@/lib/config/types";
import type { ScreenData } from "@/lib/runtime/screen";

/**
 * One screen, drawn whichever way it was written.
 *
 * A screen holds either a composed tree or a React component the agent wrote,
 * and this is the single place that decision is made. Both call sites — the
 * `/screens/[screenId]` route and the builder's live preview — go through here,
 * so the two paths cannot drift into behaving differently.
 */
export function ScreenSurface({
  screen,
  config,
  data,
  onAskAgent,
}: {
  screen: ScreenConfig;
  config: Config;
  /** Resolved server-side for a composed screen; empty for a coded one. */
  data: ScreenData;
  onAskAgent?: (prompt: string) => void;
}) {
  const router = useRouter();

  const context = React.useMemo(
    () => ({
      config,
      onOpenRecord: (recordId: string) => router.push(`/records/${recordId}`),
      onAskAgent,
    }),
    [config, router, onAskAgent],
  );

  if (screen.source) {
    return <GeneratedScreen screen={screen} context={context} />;
  }

  return <ScreenRenderer screen={screen} config={config} data={data} onAskAgent={onAskAgent} />;
}
