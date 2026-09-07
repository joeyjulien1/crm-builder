import type { ImpactSummary } from "./types";

/**
 * Whether a change is worth stopping the user for.
 *
 * It used to stop for anything marked destructive, which meant building a CRM
 * in an empty workspace — deleting a starter view nobody had looked at, say —
 * put a confirmation in front of someone who had just asked for exactly that.
 * A prompt you always accept is not a safety feature; it is a step, and it
 * teaches people to click through the one that matters.
 *
 * So the question is not "is this destructive" but "is there something to
 * lose". Removing a field no record has ever held loses nothing. Removing one
 * that 412 records use loses those 412 values, and that is worth a sentence and
 * a button. Anything that leaves the building — an email, a webhook, a text —
 * always confirms, because it cannot be undone by a rollback.
 */
export function needsConfirmation(impact?: ImpactSummary): boolean {
  // No impact computed means we do not know what this would do. Ask.
  if (!impact) return true;

  if (impact.hasExternalEffects) return true;

  return impact.items.some((item) => item.destructive && (item.affectedRecords ?? 0) > 0);
}
