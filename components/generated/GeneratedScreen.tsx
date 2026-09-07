"use client";

import * as React from "react";
import { compileScreen } from "./compile";
import { buildScope, type ScreenContext } from "./scope";
import { ErrorNote, Loading } from "./kit";
import type { ScreenConfig } from "@/lib/config/types";

/**
 * Renders a screen the agent wrote as code.
 *
 * Compilation happens once per source string and is memoised, because a screen
 * recompiling on every keystroke of a parent's state would be visible.
 *
 * Failure is a first-class state here, not an afterthought. A model writes code
 * that sometimes does not compile and sometimes throws on the third render when
 * a record is missing a field. Both have to land as a legible message with the
 * line in it — never a white page, and never a crash that takes the app shell
 * with it. That is what the boundary below is for.
 */
export function GeneratedScreen({
  screen,
  context,
}: {
  screen: ScreenConfig;
  context: ScreenContext;
}) {
  const source = screen.source ?? "";

  /**
   * Nothing is compiled or evaluated until this is running in a browser.
   *
   * A client component still renders on the server during SSR, so without this
   * gate the generated component would be evaluated in the Node process — next
   * to the database pool, inside the request. That is precisely the thing this
   * design exists to avoid. The cost is that a coded screen has no server-
   * rendered first paint, which costs nothing real: its records are fetched
   * from the browser anyway, so the server has nothing to draw yet.
   */
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const scope = React.useMemo(() => buildScope(context), [context]);
  const compiled = React.useMemo(
    () => (mounted ? compileScreen(source, scope) : null),
    [mounted, source, scope],
  );

  if (!compiled) return <Loading />;

  if (!compiled.ok) {
    return (
      <Failure
        title={`"${screen.name}" could not be compiled`}
        detail={compiled.message}
        line={compiled.line}
        source={source}
      />
    );
  }

  const Component = compiled.Component as React.ComponentType<Record<string, unknown>>;

  return (
    <ScreenBoundary name={screen.name}>
      <Component />
    </ScreenBoundary>
  );
}

/* -------------------------------------------------------------------------- */

interface BoundaryState {
  error: Error | null;
}

/**
 * A screen that throws takes itself down and nothing else. Without this, one
 * bad generated screen unmounts the whole app shell — the builder, the agent
 * panel and the navigation out of it included.
 */
class ScreenBoundary extends React.Component<
  { name: string; children: React.ReactNode },
  BoundaryState
> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error("generated screen failed:", error);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <Failure
          title={`"${this.props.name}" stopped while it was drawing`}
          detail={this.state.error.message}
        />
      );
    }
    return this.props.children;
  }
}

function Failure({
  title,
  detail,
  line,
  source,
}: {
  title: string;
  detail: string;
  line?: number;
  source?: string;
}) {
  const excerpt = React.useMemo(() => {
    if (!source || !line) return null;
    const lines = source.split(/\r?\n/);
    const from = Math.max(0, line - 3);
    return lines.slice(from, line + 2).map((text, index) => ({
      number: from + index + 1,
      text,
    }));
  }, [source, line]);

  return (
    <div className="flex flex-col gap-3 p-5">
      <ErrorNote>
        {title}: {detail}
        {line ? ` (line ${line})` : ""}
      </ErrorNote>

      {excerpt && (
        <pre className="overflow-x-auto rounded border border-edge bg-surface-sunken p-3 text-xs">
          {excerpt.map((row) => (
            <div key={row.number} className={row.number === line ? "text-danger" : "text-content-muted"}>
              <span className="mr-3 select-none opacity-60">{String(row.number).padStart(3, " ")}</span>
              {row.text}
            </div>
          ))}
        </pre>
      )}

      <p className="text-xs text-content-secondary">
        Ask the agent to fix it — it can read this screen and rewrite it.
      </p>
    </div>
  );
}
