import { readFileSync } from "node:fs";
import { join } from "node:path";

/** A value quoted in .env is quoted for the shell's benefit, not the app's. */
function unquote(value: string): string {
  const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
  return quoted?.[1] ?? value;
}

/** Loads .env for tests without pulling in a dotenv dependency. */
const envPath = join(process.cwd(), ".env");
try {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, key, value] = match;
    if (key && value !== undefined && process.env[key] === undefined) {
      process.env[key] = unquote(value);
    }
  }
} catch {
  // Falls through to whatever the environment already provides.
}
