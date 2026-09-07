import { and, desc, eq } from "drizzle-orm";
import { projects } from "./db/schema";
import type { Db } from "./db/client";
import type { Config } from "./config/types";

/**
 * Saved generations. A project is a whole CRM — the full configuration as it
 * was when a build finished — not a patch or a prompt. Opening one writes it
 * forward as a new config version (exactly like a rollback), so going back
 * never destroys what is current.
 */

export interface ProjectSummary {
  id: string;
  name: string;
  prompt: string;
  /** ISO string — client props must stay JSON-serializable. */
  createdAt: string;
}

export interface Project extends ProjectSummary {
  config: Config;
}

function toSummary(
  row: Pick<typeof projects.$inferSelect, "id" | "name" | "prompt" | "createdAt">,
): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Newest first. List rows never carry the config — the detail route does. */
export async function listProjects(db: Db, tenantId: string): Promise<ProjectSummary[]> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      prompt: projects.prompt,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(eq(projects.tenantId, tenantId))
    .orderBy(desc(projects.createdAt));
  return rows.map(toSummary);
}

export async function getProject(db: Db, tenantId: string, id: string): Promise<Project | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)))
    .limit(1);
  if (!row) return null;
  return { ...toSummary(row), config: row.config };
}

export async function saveProject(
  db: Db,
  tenantId: string,
  input: { name: string; prompt: string; config: Config },
): Promise<ProjectSummary> {
  const [row] = await db
    .insert(projects)
    .values({ tenantId, name: input.name, prompt: input.prompt, config: input.config })
    .returning({ id: projects.id, name: projects.name, prompt: projects.prompt, createdAt: projects.createdAt });
  if (!row) throw new Error("The project could not be saved.");
  return toSummary(row);
}
