import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { logKpiUpdate } from "@/lib/kpis/commands";
import { logKpiUpdateSchema } from "@/lib/kpis/schemas";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) { const s=await auth(); if(!s?.user)return NextResponse.json({error:"Unauthorized"},{status:401}); try { const {id}=await params; const actor=await toSabahActor(s.user); const input=logKpiUpdateSchema.parse({id,...await request.json()}); const result=await logKpiUpdate(id,input,actor); return NextResponse.json({success:true,update:result.update,score:result.update?.score}); } catch(e:any){return NextResponse.json({error:e?.issues??e?.message??"Failed to create KPI update"},{status:e?.status??400});} }
