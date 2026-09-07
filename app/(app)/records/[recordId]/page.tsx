import { notFound, redirect } from "next/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { recordLinks, records } from "@/lib/db/schema";
import { getCurrentVersion } from "@/lib/config/version";
import { getRecord, timelineFor, titlesFor } from "@/lib/runtime/records";
import { emailsForRecord } from "@/lib/email/sync";
import { RecordScreen } from "./RecordScreen";

export default async function RecordPage({ params }: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await params;
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const emails = await emailsForRecord(session.tenantId, recordId).catch(() => []);

  const data = await withTenant(session.tenantId, async (db) => {
    const { config } = await getCurrentVersion(db, session.tenantId);
    const record = await getRecord(db, session.tenantId, recordId);
    if (!record) return null;

    const object = config.objects.find((candidate) => candidate.key === record.objectKey);
    if (!object) return null;

    const timeline = await timelineFor(db, session.tenantId, recordId);

    // Related records, by the relations this object takes part in.
    const links = await db
      .select()
      .from(recordLinks)
      .where(and(eq(recordLinks.tenantId, session.tenantId), eq(recordLinks.fromId, recordId)));

    const relationFieldIds = object.fields
      .filter((field) => field.type === "relation")
      .map((field) => field.id);
    const referenced = relationFieldIds.map((fieldId) => record.data[fieldId]).filter(Boolean).map(String);
    const titles = await titlesFor(db, session.tenantId, config, [
      ...referenced,
      ...links.map((link) => link.toId),
    ]);

    // Records that point back at this one through a relation field.
    const inbound = await db
      .select({ id: records.id, objectKey: records.objectKey, data: records.data })
      .from(records)
      .where(
        and(
          eq(records.tenantId, session.tenantId),
          isNull(records.deletedAt),
          inArray(
            records.objectKey,
            config.relations
              .filter((relation) => relation.fromObject === object.key)
              .map((relation) => relation.toObject),
          ),
        ),
      )
      .limit(200);

    const related = config.relations
      .filter((relation) => relation.fromObject === object.key)
      .map((relation) => {
        const target = config.objects.find((candidate) => candidate.key === relation.toObject);
        const backReference = target?.fields.find(
          (field) => field.type === "relation" && field.relationKey === relation.key,
        );
        const matching = backReference
          ? inbound.filter(
              (row) => row.objectKey === relation.toObject && row.data[backReference.id] === recordId,
            )
          : [];

        return {
          label: relation.label,
          records: matching.map((row) => {
            const titleFieldId = target?.titleFieldId ?? target?.fields[0]?.id;
            const title = titleFieldId ? row.data[titleFieldId] : undefined;
            return { id: row.id, title: title ? String(title) : "Untitled" };
          }),
        };
      });

    return { config, record, object, timeline, related, titles: Object.fromEntries(titles) };
  });

  if (!data) notFound();

  const timeline = [
    ...data.timeline,
    ...emails.map((email) => ({
      id: email.id,
      kind: "email",
      actor: email.from,
      detail: { subject: email.subject },
      createdAt: email.sentAt,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <RecordScreen
      record={data.record}
      object={data.object}
      timeline={timeline}
      related={data.related}
      titles={data.titles}
    />
  );
}
