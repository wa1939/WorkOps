import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { listKpisForActor, createKpi } from "@/lib/kpis/commands";
import { createKpiSchema } from "@/lib/kpis/schemas";
export async function GET(request: Request) { const session=await auth(); if(!session?.user) return NextResponse.json({error:"Unauthorized"},{status:401}); try { const actor=await toSabahActor(session.user); const url=new URL(request.url); return NextResponse.json(await listKpisForActor({search:url.searchParams.get("search")??undefined,perspective:url.searchParams.get("perspective")??undefined},actor)); } catch(error:any) { return NextResponse.json({error:error?.message??"Failed to fetch KPIs", ...(error?.code ? { code: error.code } : {})},{status:error?.status??500}); } }
export async function POST(request: Request) { const session=await auth(); if(!session?.user) return NextResponse.json({error:"Unauthorized"},{status:401}); try { const actor=await toSabahActor(session.user); const input=createKpiSchema.parse(await request.json()); return NextResponse.json(await createKpi(input,actor),{status:201}); } catch(error:any) { return NextResponse.json({error:error?.issues??error?.message??"Failed to create KPI"},{status:error?.status??400}); } }
