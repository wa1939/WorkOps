import * as React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type ExternalResponsibilityCardProps = {
  owner: { name: string };
  contact: {
    name: string;
    email: string;
    department: string | null;
    organization: string | null;
  };
  parentName: string;
  workAreaName: string;
  cancellationReason: string | null;
};

function Field({
  label,
  value,
  dir = "auto",
  className,
}: {
  label: string;
  value: string | null;
  dir?: "auto" | "ltr";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className="min-w-0 break-words text-sm font-medium [overflow-wrap:anywhere]"
        dir={dir}
      >
        {value?.trim() || "—"}
      </dd>
    </div>
  );
}

export function ExternalResponsibilityCard({
  owner,
  contact,
  parentName,
  workAreaName,
  cancellationReason,
}: ExternalResponsibilityCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>External responsibility</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
          <Field label="Internal owner" value={owner.name} />
          <Field label="External contact" value={contact.name} />
          <Field label="Email" value={contact.email} dir="ltr" />
          <Field label="Department" value={contact.department} />
          <Field label="Organization" value={contact.organization} />
          <Field label="Parent" value={parentName} />
          <Field label="Work area" value={workAreaName} />
          {cancellationReason && (
            <Field
              label="Cancellation reason"
              value={cancellationReason}
              className="md:col-span-2"
            />
          )}
        </dl>
      </CardContent>
    </Card>
  );
}
