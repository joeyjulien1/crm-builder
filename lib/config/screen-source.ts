import { transform } from "sucrase";
import { forbiddenInSource } from "./schema";

/**
 * Does this screen's code actually parse?
 *
 * A model writes unbalanced JSX often enough that this is a certainty, not an
 * edge case — a missing `</Page>` on the error branch, twenty lines down, in a
 * screen that is otherwise fine. Without this check that screen is *saved*, and
 * the first person to know is the user, looking at a compile error where their
 * pipeline should be.
 *
 * So the parse runs before the patch is staged. The agent gets the message and
 * the line and retries, which is the loop it already has for a patch that fails
 * validation. Nobody stores a screen that cannot draw.
 *
 * This is a parse, not an evaluation: Sucrase reads the source and emits
 * JavaScript. Nothing in the screen runs here, which is why it is safe on the
 * server. Running it is still the browser's job alone.
 */
export function checkScreenSource(source: string): string | undefined {
  const banned = forbiddenInSource(source);
  if (banned) return banned;

  try {
    transform(source, {
      transforms: ["jsx", "typescript"],
      jsxRuntime: "classic",
      jsxPragma: "__jsx",
      jsxFragmentPragma: "__Fragment",
      production: true,
    });
  } catch (error) {
    return describeParseError(error, source);
  }

  if (!/export\s+default|function\s+(Screen|App|Page)\s*\(/.test(source)) {
    return "there is no component in it — end the file with `export default function Screen() { … }`";
  }

  return undefined;
}

/**
 * "Unexpected token (20:57)" tells a model nothing it can act on. The line it
 * failed on does.
 */
function describeParseError(error: unknown, source: string): string {
  const message = (error instanceof Error ? error.message : String(error)).replace(/^Error:\s*/, "");
  const position = /\((\d+):(\d+)\)/.exec(message);
  if (!position) return message;

  const line = Number(position[1]);
  const text = source.split(/\r?\n/)[line - 1];
  if (!text) return message;

  return `${message} — line ${line} is: ${text.trim()}. Check that every tag you opened is closed.`;
}
