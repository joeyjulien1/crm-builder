"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { rollbackTo } from "@/lib/config/version";
import { PatchError } from "@/lib/config/patch";

export async function rollbackAction(version: number): Promise<{ error?: string } | void> {
  const session = await requireSession();
  if (!session.canEditConfig) {
    return { error: "Your role cannot change this workspace's configuration." };
  }

  try {
    await withTenant(session.tenantId, (db) => rollbackTo(db, session.tenantId, version, session.email));
  } catch (error) {
    if (error instanceof PatchError) return { error: error.message };
    throw error;
  }

  revalidatePath("/settings/history");
}
