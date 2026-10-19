"use client";
import React from "react";
export type SpecialistActivityItem = { id: string; specialist: string; status: string; checkpoint?: string | null; correlationId?: string | null; recovery?: string | null };
export function SpecialistActivity({ items }: { items: SpecialistActivityItem[] }) {
  if (!items.length) return null;
  return <section aria-label="Specialist activity" className="space-y-2 rounded-lg border p-4"><h2 className="font-semibold">Specialist activity</h2><ul className="space-y-2">{items.map((item) => <li key={item.id} className="text-sm"><div className="flex justify-between"><span className="font-medium">{item.specialist}</span><span>{item.status}</span></div>{item.checkpoint && <p className="text-muted-foreground">Checkpoint: {item.checkpoint}</p>}{item.correlationId && <p className="text-muted-foreground">Correlation: {item.correlationId}</p>}{item.recovery && <p className="text-muted-foreground">Recovery: {item.recovery}</p>}</li>)}</ul></section>;
}
