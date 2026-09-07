"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { CrmRecord, FieldConfig, ObjectConfig } from "@/lib/config/types";
import { RecordDetail, type RelatedGroup, type TimelineEntry } from "@/components/renderers/RecordDetail";
import type { FieldLookup } from "@/components/renderers/FieldRenderer";
import { updateRecordFieldAction } from "../../actions";

export function RecordScreen({
  record,
  object,
  timeline,
  related,
  titles,
}: {
  record: CrmRecord;
  object: ObjectConfig;
  timeline: TimelineEntry[];
  related: RelatedGroup[];
  titles: Record<string, string>;
}) {
  const router = useRouter();

  const lookup: FieldLookup = React.useMemo(
    () => ({
      labelFor: (id) => titles[id],
      optionsFor: (field: FieldConfig) =>
        field.type === "relation"
          ? Object.entries(titles).map(([id, title]) => ({ value: id, label: title }))
          : [],
    }),
    [titles],
  );

  return (
    <RecordDetail
      variant="page"
      record={record}
      object={object}
      timeline={timeline}
      related={related}
      lookup={lookup}
      onClose={() => router.back()}
      onOpenRecord={(recordId) => router.push(`/records/${recordId}`)}
      onSave={async (fieldId, value) => {
        const result = await updateRecordFieldAction(record.id, fieldId, value);
        if ("message" in result) throw new Error(result.message);
        router.refresh();
      }}
    />
  );
}
