import { NextResponse } from "next/server";
import { POST as connectorPost } from "@/app/api/admin/ai/connectors/route";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const params = await context.params;
  return connectorPost(new Request(request, { method: "POST", body: JSON.stringify({ action: "test", id: params.id }) }));
}
