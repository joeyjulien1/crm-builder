import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { Config, ConfigPatch } from "@/lib/config/types";

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roles = pgTable("roles", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  canEditConfig: boolean("can_edit_config").notNull().default(false),
  canManageMembers: boolean("can_manage_members").notNull().default(false),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleKey: text("role_key")
      .notNull()
      .references(() => roles.key),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("memberships_tenant_user_idx").on(t.tenantId, t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* -------------------------------------------------------------------------- */
/* Configuration — append-only                                                 */
/* -------------------------------------------------------------------------- */

export const configVersions = pgTable(
  "config_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    parentId: uuid("parent_id"),
    config: jsonb("config").$type<Config>().notNull(),
    patch: jsonb("patch").$type<ConfigPatch[]>().notNull(),
    author: text("author").notNull(),
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("config_versions_tenant_version_idx").on(t.tenantId, t.version),
    index("config_versions_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Data — one generic table, see docs/ARCHITECTURE.md                          */
/* -------------------------------------------------------------------------- */

export type RecordData = Record<string, unknown>;

export const records = pgTable(
  "records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    data: jsonb("data").$type<RecordData>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("records_tenant_object_updated_idx").on(t.tenantId, t.objectKey, t.updatedAt.desc()),
    index("records_data_gin_idx").using("gin", t.data),
  ],
);

export const recordLinks = pgTable(
  "record_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    fromId: uuid("from_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    toId: uuid("to_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    relationKey: text("relation_key").notNull(),
  },
  (t) => [
    index("record_links_from_idx").on(t.tenantId, t.fromId, t.relationKey),
    index("record_links_to_idx").on(t.tenantId, t.toId, t.relationKey),
    uniqueIndex("record_links_unique_idx").on(t.tenantId, t.fromId, t.toId, t.relationKey),
  ],
);

/* -------------------------------------------------------------------------- */
/* Agent metering and failure log — the two things tracked from day one        */
/* -------------------------------------------------------------------------- */

export const agentTurns = pgTable(
  "agent_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    model: text("model").notNull(),
    producedPatch: boolean("produced_patch").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_turns_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

/** Every patch that failed validation, was discarded, or never arrived. */
export const agentFailures = pgTable(
  "agent_failures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    prompt: text("prompt").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_failures_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

export const tokenBudgets = pgTable(
  "token_budgets",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    monthlyTokenLimit: integer("monthly_token_limit").notNull().default(2_000_000),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull().defaultNow(),
    tokensUsed: integer("tokens_used").notNull().default(0),
  },
);

/* -------------------------------------------------------------------------- */
/* Automations                                                                 */
/* -------------------------------------------------------------------------- */

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    automationId: text("automation_id").notNull(),
    configVersion: integer("config_version").notNull(),
    depth: integer("depth").notNull().default(0),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    /** Where a run suspended by a delay step will pick up. See lib/automations/steps.ts. */
    cursor: jsonb("cursor").$type<number[]>(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb("output").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("automation_runs_idem_idx").on(t.tenantId, t.idempotencyKey),
    index("automation_runs_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    /**
     * Raw text for data/import uploads (the import reader parses this as
     * CSV), base64 for image uploads. See lib/files.ts — never branch on
     * this inline, use fileBytes().
     */
    contents: text("contents").notNull(),
    mimeType: text("mime_type").notNull().default("text/csv"),
    /** Raw byte size, before any base64 encoding. */
    byteSize: integer("byte_size").notNull().default(0),
    /** 'import' | 'image' | 'data'. */
    kind: text("kind").notNull().default("import"),
    /** Set when a file is attached to a record; uploads start unlinked. */
    recordId: uuid("record_id").references(() => records.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("files_tenant_idx").on(t.tenantId), index("files_tenant_record_idx").on(t.tenantId, t.recordId)],
);

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    mapping: jsonb("mapping").$type<Record<string, unknown>>().notNull(),
    dedupeKey: text("dedupe_key"),
    status: text("status").notNull().default("queued"),
    processed: integer("processed").notNull().default(0),
    created: integer("created").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    total: integer("total").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("import_jobs_tenant_idx").on(t.tenantId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Projects — saved generations, one whole CRM per row                         */
/* -------------------------------------------------------------------------- */

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    config: jsonb("config").$type<Config>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_tenant_created_idx").on(t.tenantId, t.createdAt.desc())],
);

/* -------------------------------------------------------------------------- */
/* Connections — every third-party OAuth grant, one shape for all providers    */
/*                                                                             */
/* Which providers exist is configuration, not schema: see                     */
/* lib/connectors/registry.ts. Adding one must never mean a migration.         */
/* -------------------------------------------------------------------------- */

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** OAuth is granted by a person, not by a workspace. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    /** The provider's own id for the account, stable across renames. */
    externalAccountId: text("external_account_id").notNull(),
    /** What to show the user: an address or workspace name. Never a token. */
    accountLabel: text("account_label").notNull(),
    /** Encrypted at rest, and never returned to the client. */
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    /** Exactly what was granted, so the agent can tell what it may attempt. */
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    /** 'active' | 'expired' | 'revoked' */
    status: text("status").notNull().default("active"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("connections_unique_idx").on(t.tenantId, t.userId, t.provider, t.externalAccountId),
    index("connections_lookup_idx").on(t.tenantId, t.userId, t.provider),
  ],
);

/* -------------------------------------------------------------------------- */
/* Email — sync state for a mailbox; the grant itself is a connection          */
/* -------------------------------------------------------------------------- */

export const emailAccounts = pgTable(
  "email_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    address: text("address").notNull(),
    /**
     * The OAuth grant lives in `connections`. This row holds only what mail
     * sync needs to know, so there is one place a token can be revoked from.
     */
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    historyId: text("history_id"),
    storeBodies: boolean("store_bodies").notNull().default(false),
    backfillCursor: text("backfill_cursor"),
    backfillDone: boolean("backfill_done").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("email_accounts_unique_idx").on(t.tenantId, t.userId, t.address)],
);

export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    providerMessageId: text("provider_message_id").notNull(),
    threadId: text("thread_id"),
    subject: text("subject"),
    fromAddress: text("from_address").notNull(),
    toAddresses: jsonb("to_addresses").$type<string[]>().notNull().default([]),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    /** Only populated when the user opted in. Otherwise the pointer is enough. */
    body: text("body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_messages_provider_idx").on(t.tenantId, t.accountId, t.providerMessageId),
    index("email_messages_tenant_sent_idx").on(t.tenantId, t.sentAt),
  ],
);

export const emailLinks = pgTable(
  "email_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => emailMessages.id, { onDelete: "cascade" }),
    recordId: uuid("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    matchedBy: text("matched_by").notNull(),
  },
  (t) => [
    uniqueIndex("email_links_unique_idx").on(t.tenantId, t.messageId, t.recordId),
    index("email_links_record_idx").on(t.tenantId, t.recordId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Per-user view preferences — column widths, persisted                        */
/* -------------------------------------------------------------------------- */

export const viewPrefs = pgTable(
  "view_prefs",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    viewId: text("view_id").notNull(),
    columnWidths: jsonb("column_widths").$type<Record<string, number>>().notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId, t.viewId] })],
);

/** Timeline entries that are not emails: notes, field changes, automation runs. */
export const activityEntries = pgTable(
  "activity_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    recordId: uuid("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    actor: text("actor").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_entries_record_idx").on(t.tenantId, t.recordId, t.createdAt)],
);

/**
 * Inbound webhooks. The token is the credential — unguessable, unique, and the
 * only thing a caller presents — so a row is created per workflow and deleted
 * when that workflow stops accepting posts.
 */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    automationId: text("automation_id").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("webhook_endpoints_automation_idx").on(t.tenantId, t.automationId)],
);

/**
 * Every table above that carries tenant_id. The RLS test asserts this list
 * matches what Postgres reports, so a new tenant-scoped table without a policy
 * fails CI rather than leaking.
 */
export const TENANT_SCOPED_TABLES = [
  "activity_entries",
  "agent_failures",
  "agent_turns",
  "automation_runs",
  "config_versions",
  "connections",
  "email_accounts",
  "email_links",
  "email_messages",
  "files",
  "import_jobs",
  "memberships",
  "projects",
  "record_links",
  "records",
  "token_budgets",
  "view_prefs",
  "webhook_endpoints",
] as const;

export const CURRENT_TENANT = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;
