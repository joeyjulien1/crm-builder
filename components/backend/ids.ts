/**
 * Ids minted in the browser, in the same shape the agent's `id()` produces on
 * the server (`lib/agent/tools.ts`): a prefix and eight hex characters. Both
 * authors write into the same config, so a field added by hand and one added by
 * the agent have to be indistinguishable afterwards.
 */
export function mintId(prefix: string): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

/**
 * A lower_snake_case key from a human label, avoiding the ones already taken.
 * Mirrors `keyFrom` in lib/agent/tools.ts — the `identifier` regex in the schema
 * rejects anything else, and a rejected patch reads like a bug to the user.
 */
export function keyFrom(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^([0-9])/, "f$1") || "field";

  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}
