import { transform } from "sucrase";

/**
 * Turning a screen the agent wrote into something React can render.
 *
 * Sucrase strips the types and compiles the JSX; nothing else. There is no
 * bundler, no module resolution and no network — an `import` cannot be
 * satisfied and is rejected before it gets here (`forbiddenInSource` in
 * lib/config/schema.ts).
 *
 * **Where the safety actually comes from.** Not from reading the source: a
 * regex over code is a hint, not a boundary. It comes from the fact that this
 * runs in the browser, in the user's own session, with a hand-written scope
 * object as its entire vocabulary. The compiled function is called with exactly
 * the names in that scope and nothing else is in lexical reach — no `fetch`, no
 * `process`, no `require`, no module registry. Everything it can read or write
 * goes through a server action that opens a tenant-scoped transaction, so the
 * database enforces isolation exactly as it did before any of this existed.
 *
 * The honest limit: this is not a security sandbox against a hostile author.
 * Generated code shares an origin with the app, so someone who could make the
 * model emit arbitrary code could reach what that user could already reach.
 * That is the same trust boundary as the agent having tools at all — the model
 * is writing for the tenant, inside the tenant's own session.
 */

export interface CompileSuccess {
  ok: true;
  /** The component, already evaluated. */
  Component: (props: Record<string, unknown>) => unknown;
}

export interface CompileFailure {
  ok: false;
  message: string;
  /** 1-based, when the compiler tells us. */
  line?: number;
}

export type CompileResult = CompileSuccess | CompileFailure;

/**
 * Compiles and evaluates. The source must end in a component — either
 * `export default function Screen() {}` or a bare `function Screen() {}` — and
 * the export syntax is rewritten rather than refused, because that is what a
 * model writes when asked for a React component and refusing it teaches
 * nothing.
 */
export function compileScreen(source: string, scope: Record<string, unknown>): CompileResult {
  let compiled: string;

  try {
    const { code } = transform(source, {
      transforms: ["jsx", "typescript"],
      jsxRuntime: "classic",
      jsxPragma: "__jsx",
      jsxFragmentPragma: "__Fragment",
      production: true,
    });
    compiled = code;
  } catch (error) {
    return { ok: false, ...readCompileError(error) };
  }

  // `export default X` and `export function X` cannot run outside a module, so
  // they become an assignment to the slot the wrapper returns.
  const rewritten = compiled
    .replace(/export\s+default\s+function\s+(\w+)/, "__screen = function $1")
    .replace(/export\s+default\s+/, "__screen = ")
    .replace(/export\s+(function|const|let|var)\s+/g, "$1 ");

  const names = Object.keys(scope);
  const values = Object.values(scope);

  try {
    const factory = new Function(
      ...names,
      `"use strict";
let __screen;
${rewritten}
if (typeof __screen !== "function") {
  __screen = typeof Screen === "function" ? Screen
    : typeof App === "function" ? App
    : typeof Page === "function" ? Page
    : undefined;
}
return __screen;`,
    );

    const Component = factory(...values) as CompileSuccess["Component"] | undefined;
    if (typeof Component !== "function") {
      return {
        ok: false,
        message:
          "This screen has no component in it. End the file with `export default function Screen() { … }`.",
      };
    }
    return { ok: true, Component };
  } catch (error) {
    return { ok: false, ...readCompileError(error) };
  }
}

/** Pulls a line number out of whatever the compiler threw, when there is one. */
function readCompileError(error: unknown): { message: string; line?: number } {
  const message = error instanceof Error ? error.message : String(error);

  // Sucrase reports "Error: unexpected token (4:12)".
  const position = /\((\d+):(\d+)\)/.exec(message);
  const line = position ? Number(position[1]) : undefined;

  return { message: message.replace(/^Error:\s*/, ""), line };
}
