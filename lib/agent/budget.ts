import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { agentTurns, tokenBudgets } from "@/lib/db/schema";

/**
 * Every agent turn is metered per tenant. The budget is checked before the API
 * call, not after — a tenant that is out of budget must not be able to spend
 * one more turn's worth of tokens finding that out.
 */

export interface BudgetState {
  limit: number;
  used: number;
  remaining: number;
  /** 0 to 1. The UI warns from 0.8 and shows the remaining budget from 0.8. */
  fraction: number;
  exhausted: boolean;
}

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetError";
  }
}

/** Dollars per million tokens, in cents, so cost stays integer arithmetic. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 500, output: 2500 },
  "claude-sonnet-5": { input: 200, output: 1000 },
  "claude-haiku-4-5": { input: 100, output: 500 },
  "gemini-3.7-flash": { input: 30, output: 250 },
  "gemini-3.6-flash": { input: 30, output: 250 },
  "gemini-3.5-flash": { input: 30, output: 250 },
  "gemini-3-flash-preview": { input: 30, output: 250 },
};

/** An unpriced model bills at the dearest rate rather than silently at zero. */
const FALLBACK_PRICING = PRICING["claude-opus-5"]!;

function isBudgetDisabled(): boolean {
  const v = process.env.AGENT_BUDGET_DISABLED?.toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes";
}

function unlimited(used = 0): BudgetState {
  return {
    limit: 0,
    used,
    remaining: Number.MAX_SAFE_INTEGER,
    fraction: 0,
    exhausted: false,
  };
}

export async function getBudget(db: Db, tenantId: string): Promise<BudgetState> {
  const [row] = await db.select().from(tokenBudgets).where(eq(tokenBudgets.tenantId, tenantId)).limit(1);

  if (!row) {
    if (isBudgetDisabled()) return unlimited(0);
    const [created] = await db.insert(tokenBudgets).values({ tenantId }).returning();
    return toState(created?.monthlyTokenLimit ?? 0, 0);
  }

  // AGENT_BUDGET_DISABLED=1 (or setting monthly_token_limit to 0) means
  // unlimited: usage is still metered via agent_turns, just never blocked.
  if (isBudgetDisabled()) return unlimited(row.tokensUsed);

  // A monthly_token_limit of 0 or less also means unlimited.
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (row.periodStart < monthAgo) {
    const [reset] = await db
      .update(tokenBudgets)
      .set({ tokensUsed: 0, periodStart: new Date() })
      .where(eq(tokenBudgets.tenantId, tenantId))
      .returning();
    return toState(reset?.monthlyTokenLimit ?? row.monthlyTokenLimit, 0);
  }

  return toState(row.monthlyTokenLimit, row.tokensUsed);
}

function toState(limit: number, used: number): BudgetState {
  // A limit of 0 or less means unlimited — usage is metered, never blocked.
  // (Previously 0 meant always-exhausted, which made "no limit" impossible.)
  if (limit <= 0) return unlimited(used);
  const remaining = Math.max(0, limit - used);
  return {
    limit,
    used,
    remaining,
    fraction: Math.min(1, used / limit),
    exhausted: remaining <= 0,
  };
}

/** Call this before the API call. It throws rather than returning a flag. */
export async function assertWithinBudget(db: Db, tenantId: string): Promise<BudgetState> {
  const budget = await getBudget(db, tenantId);
  if (budget.exhausted) {
    throw new BudgetError(
      "This workspace has used its configuration budget for the month. It resets at the start of the next period, or an owner can raise the limit in settings.",
    );
  }
  return budget;
}

export async function recordTurn(
  db: Db,
  tenantId: string,
  input: {
    userId?: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    producedPatch: boolean;
  },
): Promise<void> {
  // OpenRouter marks its no-cost variants with a :free suffix. Tokens still
  // count against the budget; money does not.
  const pricing = input.model.endsWith(":free")
    ? { input: 0, output: 0 }
    : (PRICING[input.model] ?? FALLBACK_PRICING);

  const costCents = Math.round(
    (input.inputTokens * pricing.input + input.outputTokens * pricing.output) / 1_000_000,
  );

  await db.insert(agentTurns).values({
    tenantId,
    userId: input.userId ?? null,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costCents,
    producedPatch: input.producedPatch,
  });

  await db
    .update(tokenBudgets)
    .set({ tokensUsed: sql`${tokenBudgets.tokensUsed} + ${input.inputTokens + input.outputTokens}` })
    .where(eq(tokenBudgets.tenantId, tenantId));
}
