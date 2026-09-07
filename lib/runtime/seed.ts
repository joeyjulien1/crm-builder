import type { Db } from "@/lib/db/client";
import type { Config } from "@/lib/config/types";
import { createRecord } from "./records";

/**
 * Seeds initial live database records into Postgres when a new CRM archetype
 * is created or applied, ensuring the user immediately has real interactive records
 * to drag, sort, edit, and view rather than static mockups.
 */
export async function seedInitialRecords(db: Db, tenantId: string, config: Config): Promise<void> {
  const contactObj = config.objects.find((o) => o.key === "contact");
  if (!contactObj) return;

  const getFId = (key: string) => contactObj.fields.find((f) => f.key === key)?.id;
  const nameFId = getFId("name") ?? contactObj.fields[0]?.id;
  const emailFId = getFId("email");
  const phoneFId = getFId("phone");

  const layoutStyle = config.brand?.layoutStyle ?? "clinic";

  let samplePeople = [
    { name: "Eleanor Vance", email: "eleanor.vance@example.com", phone: "(555) 234-8901" },
    { name: "Marcus Chen", email: "marcus.chen@example.com", phone: "(555) 432-1098" },
    { name: "Sophia Patel", email: "sophia.patel@example.com", phone: "(555) 789-2341" },
  ];

  if (layoutStyle === "legal") {
    samplePeople = [
      { name: "Vanguard Tech Inc.", email: "legal@vanguardtech.com", phone: "(555) 789-0123" },
      { name: "Apex Horizon Partners", email: "contact@apexhorizon.com", phone: "(555) 456-7890" },
      { name: "Dr. Jonathan Hayes", email: "j.hayes@medicalpractice.com", phone: "(555) 890-1234" },
    ];
  } else if (layoutStyle === "fitness") {
    samplePeople = [
      { name: "Samantha Reynolds", email: "s.reynolds@example.com", phone: "(555) 234-9812" },
      { name: "Derrick Cole", email: "derrick.cole@example.com", phone: "(555) 765-4321" },
      { name: "Olivia Sterling", email: "olivia.s@example.com", phone: "(555) 987-1234" },
    ];
  } else if (layoutStyle === "real_estate") {
    samplePeople = [
      { name: "The Bel Air Vista Estate", email: "client.sterling@example.com", phone: "(555) 310-9821" },
      { name: "Malibu Cove Waterfront Villa", email: "oceanic.buyer@example.com", phone: "(555) 310-4421" },
      { name: "Tribeca Cast Iron Penthouse", email: "marcus.gold@example.com", phone: "(555) 212-9081" },
    ];
  }

  for (const person of samplePeople) {
    const vals: Record<string, unknown> = {};
    if (nameFId) vals[nameFId] = person.name;
    if (emailFId) vals[emailFId] = person.email;
    if (phoneFId) vals[phoneFId] = person.phone;
    try {
      await createRecord(db, tenantId, config, "contact", vals, "agent_seed");
    } catch {
      // Continue if validation differs
    }
  }

  // Also seed deals / matters / plans for the pipeline
  const dealObj = config.objects.find((o) => o.key === "deal");
  const pipeline = config.pipelines.find((p) => p.objectKey === "deal") ?? config.pipelines[0];
  if (dealObj && pipeline && pipeline.stages.length > 0) {
    const dealNameFId = dealObj.fields.find((f) => f.key === "title" || f.key === "name")?.id ?? dealObj.fields[0]?.id;
    const stageFId = pipeline.stageFieldId;

    const sampleDeals = [
      { title: `Priority ${dealObj.label} 1`, stage: pipeline.stages[0]?.key },
      { title: `Active ${dealObj.label} 2`, stage: pipeline.stages[1]?.key ?? pipeline.stages[0]?.key },
      { title: `Pending ${dealObj.label} 3`, stage: pipeline.stages[2]?.key ?? pipeline.stages[0]?.key },
    ];

    for (const deal of sampleDeals) {
      const vals: Record<string, unknown> = {};
      if (dealNameFId) vals[dealNameFId] = deal.title;
      if (stageFId && deal.stage) vals[stageFId] = deal.stage;
      try {
        await createRecord(db, tenantId, config, "deal", vals, "agent_seed");
      } catch {
        // Continue
      }
    }
  }
}
