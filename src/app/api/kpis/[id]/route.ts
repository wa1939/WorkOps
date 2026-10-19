import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { getKpiForActor, updateKpi } from "@/lib/kpis/commands";
import { updateKpiSchema } from "@/lib/kpis/schemas";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) { const s=await auth(); if(!s?.user)return NextResponse.json({error:"Unauthorized"},{status:401}); try { const {id}=await params; const v=await getKpiForActor(id,await toSabahActor(s.user)); return v?NextResponse.json(v):NextResponse.json({error:"KPI not found"},{status:404}); } catch(e:any) { return NextResponse.json({error:e?.message??"Failed to fetch KPI"},{status:e?.status??500}); } }
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}) { const s=await auth(); if(!s?.user)return NextResponse.json({error:"Unauthorized"},{status:401}); try { const {id}=await params; const actor=await toSabahActor(s.user); const body=await request.json(); const input=updateKpiSchema.parse({id,...body}); return NextResponse.json(await updateKpi(id,input,actor)); } catch(e:any){return NextResponse.json({error:e?.issues??e?.message??"Failed to update KPI"},{status:e?.status??400});} }
