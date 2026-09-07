import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { and, eq, gt, sql } from "drizzle-orm";
import { withoutTenant, withTenant, type Db } from "@/lib/db/client";
import { memberships, roles, sessions, tenants, tokenBudgets, users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "./passwords";

const COOKIE = "crm_session";
const SESSION_DAYS = 30;
const MAX_AGE_SECONDS = SESSION_DAYS * 24 * 60 * 60;

export interface SessionUser {
  userId: string;
  email: string;
  name: string;
  tenantId: string;
  tenantName: string;
  roleKey: string;
  canEditConfig: boolean;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Creating a workspace is the one write that happens before a tenant context
 * exists, so it sets app.tenant_id to the id it is about to insert. That keeps
 * even signup inside the RLS envelope rather than around it.
 */
export async function signUp(input: {
  email: string;
  password: string;
  name: string;
  workspace: string;
}): Promise<SessionUser> {
  const email = input.email.trim().toLowerCase();
  const existing = await withoutTenant((db) =>
    db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1),
  );
  if (existing.length > 0) throw new AuthError("That email already has an account. Sign in instead.");

  const passwordHash = await hashPassword(input.password);
  const tenantId = randomUUID();

  const userId = await withTenant(tenantId, async (db) => {
    const [user] = await db.insert(users).values({ email, name: input.name.trim(), passwordHash }).returning({ id: users.id });
    await db.insert(tenants).values({ id: tenantId, name: input.workspace.trim(), slug: `${slugify(input.workspace)}-${tenantId.slice(0, 8)}` });
    await db.insert(memberships).values({ tenantId, userId: user!.id, roleKey: "owner" });
    await db.insert(tokenBudgets).values({ tenantId });
    return user!.id;
  });
  await issueSession(userId, tenantId);
  return { userId, email, name: input.name.trim(), tenantId, tenantName: input.workspace.trim(), roleKey: "owner", canEditConfig: true };
}

export async function signIn(email: string, password: string): Promise<SessionUser> {
  const [user] = await withoutTenant((db) =>
    db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1),
  );

  const failure = new AuthError("That email and password do not match an account.");
  if (!user) {
    // Spend the same work whether or not the account exists.
    await verifyPassword(password, "scrypt$00$00");
    throw failure;
  }
  if (!(await verifyPassword(password, user.passwordHash))) throw failure;

  const workspaces = await listWorkspaces(user.id);
  const first = workspaces[0];
  if (!first) throw new AuthError("That account is not a member of any workspace.");

  await issueSession(user.id, first.tenantId);

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    tenantId: first.tenantId,
    tenantName: first.tenantName,
    roleKey: first.roleKey,
    canEditConfig: first.roleKey !== "member",
  };
}

/** The one audited path around RLS: a user's workspaces, before one is chosen. */
export async function listWorkspaces(
  userId: string,
): Promise<{ tenantId: string; tenantName: string; roleKey: string }[]> {
  const { rows } = await withoutTenant((db) => db.execute<{
    tenant_id: string;
    tenant_name: string;
    role_key: string;
  }>(sql`select tenant_id, tenant_name, role_key from app_user_memberships(${userId}::uuid)`));

  return rows.map((row) => ({
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    roleKey: row.role_key,
  }));
}

async function issueSession(userId: string, tenantId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await withoutTenant((db) =>
    db.insert(sessions).values({ userId, tenantId, tokenHash: hashToken(token), expiresAt }),
  );

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
    maxAge: MAX_AGE_SECONDS,
  });


}

/**
 * The tenant comes from the session, never from a request parameter, a header,
 * or anything else the client controls.
 */
export const getSession = cache(async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  try {
    const [row] = await withoutTenant((db) =>
      db.select({ userId: users.id, email: users.email, name: users.name, tenantId: sessions.tenantId })
        .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
        .limit(1),
    );
    if (!row?.tenantId) return null;
    const [membership] = await withTenant(row.tenantId, (db: Db) =>
      db.select({ roleKey: memberships.roleKey, canEditConfig: roles.canEditConfig, tenantName: tenants.name })
        .from(memberships).innerJoin(roles, eq(roles.key, memberships.roleKey))
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(and(eq(memberships.tenantId, row.tenantId!), eq(memberships.userId, row.userId)))
        .limit(1),
    );
    if (!membership) return null;
    return { ...row, tenantId: row.tenantId, ...membership };
  } catch (error) {
    console.error("Error verifying session:", error);
    return null;
  }
});

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new AuthError("Sign in to continue.");
  return session;
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) {
    await withoutTenant((db) => db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))));
  }
  store.delete(COOKIE);


}

export async function switchWorkspace(userId: string, tenantId: string): Promise<void> {
  const workspaces = await listWorkspaces(userId);
  if (!workspaces.some((workspace) => workspace.tenantId === tenantId)) {
    throw new AuthError("You are not a member of that workspace.");
  }

  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) throw new AuthError("Sign in to continue.");

  await withoutTenant((db) =>
    db.update(sessions).set({ tenantId }).where(eq(sessions.tokenHash, hashToken(token))),
  );
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
}

export { sql };
