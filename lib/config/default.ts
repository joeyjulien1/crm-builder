import { validateConfig } from "./patch";
import type { Config } from "./types";

/**
 * The four objects and their built-in fields, and nothing else.
 *
 * This used to be what a new workspace started from *with* five named views
 * and a sales pipeline already in it — "All contacts", "All companies", "All
 * deals", "Deal board", "Open activities". That is a finished generic CRM, and
 * because every workspace booted with it, every workspace looked like it. What
 * the agent did afterwards was edit a template rather than build for a
 * business, and the sameness people complained about was mostly this, sitting
 * there before anyone had typed a prompt.
 *
 * `startingConfig` is what a new workspace gets now. `defaultConfig` is kept
 * because the tests, the seed and `blankConfig` are all written against it.
 */
export function defaultConfig(): Config {
  return validateConfig({
    schemaVersion: 1,
    objects: [
      {
        key: "contact",
        label: "Contact",
        labelPlural: "Contacts",
        titleFieldId: "fld_contact_name",
        fields: [
          { id: "fld_contact_name", key: "name", label: "Name", type: "text", required: true, system: true },
          { id: "fld_contact_email", key: "email", label: "Email", type: "email", required: false, system: true },
          { id: "fld_contact_phone", key: "phone", label: "Phone", type: "phone", required: false, system: false },
          { id: "fld_contact_title", key: "job_title", label: "Job title", type: "text", required: false, system: false },
          {
            id: "fld_contact_company",
            key: "company",
            label: "Company",
            type: "relation",
            relationKey: "company_contacts",
            required: false,
            system: false,
          },
          { id: "fld_contact_owner", key: "owner", label: "Owner", type: "user", required: false, system: false },
          { id: "fld_contact_notes", key: "notes", label: "Notes", type: "long_text", required: false, system: false },
        ],
        layout: {
          groups: [
            { label: "Details", fieldIds: ["fld_contact_name", "fld_contact_email", "fld_contact_phone", "fld_contact_title"] },
            { label: "Relationships", fieldIds: ["fld_contact_company", "fld_contact_owner"] },
            { label: "Notes", fieldIds: ["fld_contact_notes"] },
          ],
        },
      },
      {
        key: "company",
        label: "Company",
        labelPlural: "Companies",
        titleFieldId: "fld_company_name",
        fields: [
          { id: "fld_company_name", key: "name", label: "Name", type: "text", required: true, system: true },
          { id: "fld_company_domain", key: "domain", label: "Domain", type: "url", required: false, system: true },
          {
            id: "fld_company_industry",
            key: "industry",
            label: "Industry",
            type: "select",
            required: false,
            system: false,
            options: [
              { value: "software", label: "Software" },
              { value: "services", label: "Services" },
              { value: "manufacturing", label: "Manufacturing" },
              { value: "retail", label: "Retail" },
              { value: "other", label: "Other" },
            ],
          },
          { id: "fld_company_employees", key: "employees", label: "Employees", type: "number", required: false, system: false },
          { id: "fld_company_owner", key: "owner", label: "Owner", type: "user", required: false, system: false },
        ],
        layout: {
          groups: [
            { label: "Details", fieldIds: ["fld_company_name", "fld_company_domain", "fld_company_industry", "fld_company_employees"] },
            { label: "Relationships", fieldIds: ["fld_company_owner"] },
          ],
        },
      },
      {
        key: "deal",
        label: "Deal",
        labelPlural: "Deals",
        titleFieldId: "fld_deal_name",
        fields: [
          { id: "fld_deal_name", key: "name", label: "Name", type: "text", required: true, system: true },
          {
            id: "fld_deal_amount",
            key: "amount",
            label: "Amount",
            type: "currency",
            currencyCode: "USD",
            required: false,
            system: false,
          },
          {
            id: "fld_deal_stage",
            key: "stage",
            label: "Stage",
            type: "select",
            required: true,
            system: true,
            options: [
              { value: "new", label: "New" },
              { value: "qualified", label: "Qualified" },
              { value: "proposal", label: "Proposal" },
              { value: "negotiation", label: "Negotiation" },
              { value: "won", label: "Won" },
              { value: "lost", label: "Lost" },
            ],
          },
          { id: "fld_deal_close_date", key: "close_date", label: "Close date", type: "date", required: false, system: false },
          {
            id: "fld_deal_company",
            key: "company",
            label: "Company",
            type: "relation",
            relationKey: "company_deals",
            required: false,
            system: false,
          },
          { id: "fld_deal_owner", key: "owner", label: "Owner", type: "user", required: false, system: false },
        ],
        layout: {
          groups: [
            { label: "Details", fieldIds: ["fld_deal_name", "fld_deal_amount", "fld_deal_stage", "fld_deal_close_date"] },
            { label: "Relationships", fieldIds: ["fld_deal_company", "fld_deal_owner"] },
          ],
        },
      },
      {
        key: "activity",
        label: "Activity",
        labelPlural: "Activities",
        titleFieldId: "fld_activity_subject",
        fields: [
          { id: "fld_activity_subject", key: "subject", label: "Subject", type: "text", required: true, system: true },
          {
            id: "fld_activity_type",
            key: "activity_type",
            label: "Type",
            type: "select",
            required: false,
            system: false,
            options: [
              { value: "call", label: "Call" },
              { value: "meeting", label: "Meeting" },
              { value: "task", label: "Task" },
              { value: "email", label: "Email" },
            ],
          },
          { id: "fld_activity_due", key: "due_at", label: "Due", type: "datetime", required: false, system: false },
          { id: "fld_activity_done", key: "completed", label: "Completed", type: "boolean", required: false, system: false },
          {
            id: "fld_activity_contact",
            key: "contact",
            label: "Contact",
            type: "relation",
            relationKey: "contact_activities",
            required: false,
            system: false,
          },
          { id: "fld_activity_owner", key: "owner", label: "Owner", type: "user", required: false, system: false },
          { id: "fld_activity_notes", key: "notes", label: "Notes", type: "long_text", required: false, system: false },
        ],
        layout: {
          groups: [
            { label: "Details", fieldIds: ["fld_activity_subject", "fld_activity_type", "fld_activity_due", "fld_activity_done"] },
            { label: "Relationships", fieldIds: ["fld_activity_contact", "fld_activity_owner"] },
            { label: "Notes", fieldIds: ["fld_activity_notes"] },
          ],
        },
      },
    ],
    relations: [
      { key: "company_contacts", fromObject: "company", toObject: "contact", kind: "one_to_many", label: "Contacts" },
      { key: "company_deals", fromObject: "company", toObject: "deal", kind: "one_to_many", label: "Deals" },
      { key: "contact_activities", fromObject: "contact", toObject: "activity", kind: "one_to_many", label: "Activities" },
    ],
    pipelines: [
      {
        id: "pl_sales",
        objectKey: "deal",
        name: "Sales pipeline",
        stageFieldId: "fld_deal_stage",
        stages: [
          { key: "new", label: "New", probability: 10 },
          { key: "qualified", label: "Qualified", probability: 30 },
          { key: "proposal", label: "Proposal", probability: 50 },
          { key: "negotiation", label: "Negotiation", probability: 75 },
          { key: "won", label: "Won", probability: 100, isWon: true },
          { key: "lost", label: "Lost", probability: 0, isLost: true },
        ],
      },
    ],
    views: [
      {
        id: "vw_contacts",
        objectKey: "contact",
        name: "All contacts",
        renderer: "table",
        columns: ["fld_contact_name", "fld_contact_email", "fld_contact_phone", "fld_contact_company", "fld_contact_owner"],
        sort: { fieldId: "fld_contact_name", direction: "asc" },
      },
      {
        id: "vw_companies",
        objectKey: "company",
        name: "All companies",
        renderer: "table",
        columns: ["fld_company_name", "fld_company_domain", "fld_company_industry", "fld_company_employees"],
        sort: { fieldId: "fld_company_name", direction: "asc" },
      },
      {
        id: "vw_deals",
        objectKey: "deal",
        name: "All deals",
        renderer: "table",
        columns: ["fld_deal_name", "fld_deal_amount", "fld_deal_stage", "fld_deal_close_date", "fld_deal_company"],
        sort: { fieldId: "fld_deal_close_date", direction: "asc" },
      },
      {
        id: "vw_deal_board",
        objectKey: "deal",
        name: "Deal board",
        renderer: "kanban",
        pipelineId: "pl_sales",
        columns: ["fld_deal_name", "fld_deal_amount", "fld_deal_close_date"],
      },
      {
        id: "vw_open_activities",
        objectKey: "activity",
        name: "Open activities",
        renderer: "table",
        columns: ["fld_activity_subject", "fld_activity_type", "fld_activity_due", "fld_activity_contact"],
        filters: { join: "and", conditions: [{ fieldId: "fld_activity_done", operator: "is_false" }], groups: [] },
        sort: { fieldId: "fld_activity_due", direction: "asc" },
      },
    ],
    automations: [],
  });
}

/**
 * A new project: the default objects, and nothing else.
 *
 * `defaultConfig` ships starter views and a sales pipeline, which is the right
 * thing for a workspace created out of nowhere and the wrong thing for someone
 * who just asked to start over — they would find the previous CRM's shape
 * waiting for them. Everything a CRM accumulates is cleared here; only the four
 * core objects and their built-in fields remain, because those are fixed for v1.
 */
/**
 * What a new workspace opens on: nothing.
 *
 * This started as the four objects plus five named views and a sales pipeline —
 * a finished generic CRM, sitting there before anyone had typed a prompt. The
 * views went first. The objects had to follow, because contacts, companies,
 * deals and activities *are* a sales CRM: they carry `amount`, `stage`,
 * `close_date`, `industry`, `employees`. A restaurant handed that model renames
 * the labels and still gets a sales pipeline with Demo and Negotiation stages
 * in it, which is exactly what "it keeps generating the same template" meant.
 *
 * So there is no model to inherit. The agent's first job is to build one —
 * Guests, Reservations, Tables for a restaurant; Patients and Appointments for
 * a clinic — and a CRM whose objects were chosen for the business cannot look
 * like one built for a different business.
 *
 * `defaultConfig` stays: the tests and `blankConfig` are written against it,
 * and it is still the right shape for a sales team that asks for one.
 */
export function startingConfig(): Config {
  const base = defaultConfig();
  return validateConfig({
    ...base,
    objects: [],
    relations: [],
    views: [],
    screens: [],
    pipelines: [],
    automations: [],
    customAgents: [],
    theme: {},
    brand: {
      name: "New workspace",
      logoText: "N",
      accentColor: "#ffffff",
      theme: "dark",
      layoutStyle: "blank",
      kpis: [],
    },
  });
}

export function blankConfig(): Config {
  const base = defaultConfig();
  return validateConfig({
    ...base,
    views: [],
    screens: [],
    pipelines: [],
    // Relations stay: the core objects carry relation-typed fields that point
    // at them, and a config whose fields reference a relation that no longer
    // exists does not validate. They are part of the base schema, not content
    // the previous CRM accumulated.
    automations: [],
    customAgents: [],
    theme: {},
    brand: {
      name: "New project",
      tagline: undefined,
      logoText: "N",
      accentColor: "#ffffff",
      theme: "dark",
      layoutStyle: "blank",
      kpis: [],
    },
  });
}
