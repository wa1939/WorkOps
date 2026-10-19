import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { defineCapability } from "../contracts";
import type { CapabilityContext, SabahActor } from "../contracts";

import {
    computeTeamLoadSnapshot,
    effectiveCapacity,
    estimateEffortWithSource,
    loadPercentForCapacity,
    nextWeekWindows,
    saudiWeekStart,
    workdaysOnLeave,
    type WeekWindow,
} from "@/lib/team-load";
import { allocateTaskEffort, type AllocationAssignment, type AllocationTask } from "@/lib/workload/allocation";
import { reassignTask } from "@/lib/tasks/commands";

const id = z.string().min(1);
const readMember = z.object({ id, displayName: z.string(), title: z.string().nullable(), role: z.enum(["ADMIN", "LEAD", "MEMBER", "VIEWER"]), managerId: id.nullable() });
const capacity = z.object({ userId:id, role:z.enum(["ADMIN","LEAD","MEMBER","VIEWER"]), weekStart:z.string(), weekEnd:z.string(), loadHours:z.number(), capacityHours:z.number(), loadPercent:z.number(), leaveDays:z.number(), isOnLeave:z.boolean(), workAreaIds:z.array(id), sourceIds:z.array(id), drivers:z.array(z.object({taskId:id.optional(),title:z.string(),hours:z.number(),source:z.enum(["manual","ai","median","default"])})) });
const candidate = z.object({userId:id,displayName:z.string(),title:z.string().nullable(),role:z.enum(["ADMIN","LEAD","MEMBER","VIEWER"]),weekStart:z.string(),currentLoadHours:z.number(),capacityHours:z.number(),projectedLoadHours:z.number(),projectedLoadPercent:z.number(),leaveDays:z.number(),isOnLeave:z.boolean(),workAreaIds:z.array(id),sourceIds:z.array(id)});
const write = (a: SabahActor) => a.role !== "VIEWER";
const iso = (d: Date) => new Date(d).toISOString();
const display = (u:any) => u.name || "(unnamed)";
const sorted = (users:any[]) => [...users].sort((a,b)=>display(a).localeCompare(display(b),"en",{sensitivity:"base"})||a.id.localeCompare(b.id));
const pct = (h:number,c:number) => c > 0 ? Math.min(Math.round(h/c*100),200) : h > 0 ? 200 : 0;
const effort = (t:any) => estimateEffortWithSource({effortHours:t.effortHours ?? null,aiEffortHours:t.aiEffortHours ?? null});
const uniqueIds = (values:any[]) => Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)));
const flattenIds = (values:any[]) => uniqueIds(values.flatMap((value) => Array.isArray(value) ? value : [value]));
const workAreaIds = (t:any) => uniqueIds([t.project?.workAreaId, t.caseStudy?.workAreaId]);
const inWindow = (t:any,w:WeekWindow,index:number,rangeStart:Date) => {
  if (!t.dueAt) return index === 0;
  const due = new Date(t.dueAt);
  return (due >= w.weekStart && due < w.weekEnd) || (index === 0 && due < rangeStart);
};
async function users() { return prisma.user.findMany({where:{isActive:true},select:{id:true,name:true,title:true,role:true,managerId:true,capacityPerWeekHours:true}}) as Promise<any[]>; }
async function tasks() { return prisma.task.findMany({where:{isPrivate:false,status:{notIn:["DONE","CANCELED"]}},select:{id:true,title:true,dueAt:true,effortHours:true,aiEffortHours:true,actualHours:true,status:true,isPrivate:true,project:{select:{workAreaId:true}},caseStudy:{select:{workAreaId:true}},assignments:{select:{userId:true,plannedShare:true}}}}) as Promise<any[]>; }
async function leaves(w:WeekWindow) { return prisma.leaveRequest.findMany({where:{status:"Approved",startAt:{lt:w.weekEnd},endAt:{gte:w.weekStart}},select:{userId:true,startAt:true,endAt:true}}) as Promise<any[]>; }
function role(r:string): "ADMIN"|"LEAD"|"MEMBER"|"VIEWER" { return r === "MANAGER" ? "LEAD" : r as any; }

export const teamMembersCapability = defineCapability({name:"team.members",version:1,module:"team",description:"List active team members using privacy-safe fields.",risk:"READ",inputSchema:z.object({}),outputSchema:z.array(readMember),async available(){return true;},async authorize(){},async preview(){return {title:"List active team members",fields:[]};},async execute(){return sorted(await users()).map(u=>({id:u.id,displayName:display(u),title:u.title??null,role:role(u.role),managerId:u.managerId??null}));},async verify(o){return o;},summarize(o){return `${o.length} active team members.`;}});

export const teamCapacityCapability = defineCapability({name:"team.capacity",version:1,module:"team",description:"Read deterministic leave-aware capacity for active users.",risk:"READ",inputSchema:z.object({weeks:z.number().int().min(1).max(12).default(4),from:z.string().datetime().optional()}),outputSchema:z.array(capacity),async available(){return true;},async authorize(){},async preview(i){return {title:"Read team capacity",fields:[{path:"weeks",proposed:i.weeks}]};},async execute(i,c){const ws=nextWeekWindows(i.weeks ?? 4,i.from?new Date(i.from):c.now), rangeStart=ws[0].weekStart, range={...ws[0],weekEnd:ws[ws.length-1].weekEnd};const [us,ts,ls]=await Promise.all([users(),tasks(),leaves(range)]);const out:any[]=[];for(const u of sorted(us))for(let index=0;index<ws.length;index++){const w=ws[index];const items=ts.filter(t=>!t.isPrivate&&t.assignments.some((a:any)=>a.userId===u.id)&&inWindow(t,w,index,rangeStart)).map(t=>({taskId:t.id,title:t.title,workAreaIds:workAreaIds(t),...effort(t)})).sort((a,b)=>b.hours-a.hours||a.title.localeCompare(b.title)||a.taskId.localeCompare(b.taskId));const ld=workdaysOnLeave(w,ls.filter((l:any)=>l.userId===u.id)), ch=effectiveCapacity(u.capacityPerWeekHours||35,ld), h=items.reduce((n,x)=>n+x.hours,0);out.push({userId:u.id,role:role(u.role),weekStart:iso(w.weekStart),weekEnd:iso(w.weekEnd),loadHours:h,capacityHours:ch,loadPercent:pct(h,ch),leaveDays:ld,isOnLeave:ld>0,workAreaIds:uniqueIds(items.flatMap((item:any) => item.workAreaIds ?? [])),sourceIds:uniqueIds(items.map((item:any) => item.taskId)),drivers:items.slice(0,3).map(({workAreaIds: _workAreaIds, ...driver}:any) => driver)});}return out;},async verify(o){return o;},summarize(o){return `${o.length} capacity windows.`;}});

const candidatesInput=z.object({taskId:id,role:z.enum(["ADMIN","LEAD","MEMBER","VIEWER"]).optional()});
export const teamAssignmentCandidatesCapability = defineCapability({name:"team.assignmentCandidates",version:1,module:"team",description:"Find capacity-based, non-evaluative assignment candidates.",risk:"READ",inputSchema:candidatesInput,outputSchema:z.array(candidate),async available(){return true;},async authorize(){},async preview(i){return {title:"Find assignment candidates",fields:[{path:"taskId",proposed:i.taskId}]};},async execute(i,c){const t:any=await prisma.task.findFirst({where:{id:i.taskId,isPrivate:false},select:{id:true,dueAt:true,effortHours:true,aiEffortHours:true,project:{select:{workAreaId:true}},caseStudy:{select:{workAreaId:true}}}});if(!t)throw new Error("Task not found");const s=saudiWeekStart(t.dueAt?new Date(t.dueAt):c.now),w={weekStart:s,weekEnd:new Date(s),label:""};w.weekEnd.setUTCDate(w.weekEnd.getUTCDate()+7);const [us,ts,ls]=await Promise.all([users(),tasks(),leaves(w)]), ph=effort(t).hours;return sorted(us).filter(u=>!i.role||role(u.role)===i.role).map(u=>{const ld=workdaysOnLeave(w,ls.filter((l:any)=>l.userId===u.id)),ch=effectiveCapacity(u.capacityPerWeekHours||35,ld),assigned=ts.filter(x=>x.id!==i.taskId&&x.assignments.some((a:any)=>a.userId===u.id)&&inWindow(x,w,0,s)),h=assigned.reduce((n,x)=>n+effort(x).hours,0);return {userId:u.id,displayName:display(u),title:u.title??null,role:role(u.role),weekStart:iso(s),currentLoadHours:h,capacityHours:ch,projectedLoadHours:h+ph,projectedLoadPercent:pct(h+ph,ch),leaveDays:ld,isOnLeave:ld>0,workAreaIds:flattenIds([workAreaIds(t),...assigned.flatMap((x:any)=>workAreaIds(x))]),sourceIds:uniqueIds([t.id,...assigned.map((x:any)=>x.id)])};}).filter(x=>!x.isOnLeave).sort((a,b)=>a.projectedLoadPercent-b.projectedLoadPercent||a.displayName.localeCompare(b.displayName)||a.userId.localeCompare(b.userId));},async verify(o){return o;},summarize(o){return `${o.length} assignment candidates.`;}});

type RebalanceWorkloadRow = {
  userId: string;
  weekStart: Date | string;
  loadHours: number;
  loadPercent: number;
  capacityHours?: number;
  driversJson?: string | null;
};

type RebalanceWorkload = {
  rows: RebalanceWorkloadRow[];
  inputVersion: string;
  calendarVersion?: string;
  computedAt: Date | string;
};

type RebalanceCapabilityContext = CapabilityContext & {
  workloadReader?: (context: CapabilityContext) => Promise<RebalanceWorkload>;
};

export class TeamRebalanceError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
    this.name = "TeamRebalanceError";
  }
}

const rebalanceInput = z.object({
  taskId: id,
  targetUserId: id,
  expectedUpdatedAt: z.string().datetime().optional(),
  inputVersion: z.string().min(1).optional(),
  computedAt: z.string().datetime().optional(),
  calendarVersion: z.string().min(1).optional(),
  dueDate: z.string().datetime().optional(),
  dueAt: z.string().datetime().optional(),
  proposedShare: z.number().min(0).max(1).optional(),
});
type RebalanceInput = z.infer<typeof rebalanceInput>;

const allocationChange = z.object({
  person: z.string(),
  userId: id,
  displayName: z.string(),
  currentAllocatedHours: z.number(),
  proposedAllocatedHours: z.number(),
  delta: z.number(),
});
const rebalanceOutput = z.object({
  proposed: z.literal(true),
  accepted: z.boolean().optional(),
  taskId: id,
  taskTitle: z.string(),
  currentAssigneeIds: z.array(id),
  proposedAssigneeIds: z.array(id),
  weekStart: z.string(),
  inputVersion: z.string(),
  computedAt: z.string().datetime(),
  calendarVersion: z.string().optional(),
  allocations: z.array(allocationChange),
  before: z.object({loadHours:z.number(),capacityHours:z.number(),loadPercent:z.number()}),
  after: z.object({loadHours:z.number(),capacityHours:z.number(),loadPercent:z.number()}),
  warnings: z.array(z.string()),
  steps: z.array(z.object({capability:z.literal("tasks.reassign"),index:z.number(),input:z.object({id,assigneeIds:z.array(id)}),reason:z.string(),confidence:z.enum(["high","medium","low"])})),
});

function timestamp(value: Date | string, label: string): string {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TeamRebalanceError(`Authoritative workload ${label} is invalid`, 503, "WORKLOAD_DATA_UNAVAILABLE");
  return parsed.toISOString();
}

async function defaultRebalanceWorkload(context: CapabilityContext): Promise<RebalanceWorkload> {
  const computed = await computeTeamLoadSnapshot(1);
  let computedAt: Date | string = (computed as any).computedAt ?? context.now;
  const snapshotModel = (prisma as any).teamLoadSnapshot;
  if (snapshotModel?.findFirst) {
    const current = await snapshotModel.findFirst({
      where: { weekStart: { gte: computed.rangeStart, lt: computed.rangeEnd } },
      orderBy: { computedAt: "desc" },
      select: { computedAt: true, inputVersion: true, calendarVersion: true },
    });
    if (current?.inputVersion === computed.inputVersion && current.computedAt) computedAt = current.computedAt;
  }
  return {
    rows: computed.rows,
    inputVersion: computed.inputVersion,
    calendarVersion: computed.calendarVersion,
    computedAt,
  };
}

async function readRebalanceWorkload(context: RebalanceCapabilityContext): Promise<RebalanceWorkload> {
  return context.workloadReader ? context.workloadReader(context) : defaultRebalanceWorkload(context);
}

function rowDate(row: RebalanceWorkloadRow): string {
  return timestamp(row.weekStart, "week");
}

function rowForUser(workload: RebalanceWorkload, userId: string, weekStart: Date): RebalanceWorkloadRow {
  const exact = workload.rows.find((row) => row.userId === userId && rowDate(row) === weekStart.toISOString());
  const row = exact ?? workload.rows.find((candidate) => candidate.userId === userId);
  if (!row) throw new TeamRebalanceError(`Authoritative workload has no row for ${userId}`, 503, "WORKLOAD_DATA_UNAVAILABLE");
  return row;
}

function capacityForRow(row: RebalanceWorkloadRow): number {
  if (row.capacityHours != null && Number.isFinite(row.capacityHours)) return row.capacityHours;
  if (typeof row.driversJson === "string") {
    try {
      const parsed = JSON.parse(row.driversJson) as { capacity?: unknown };
      if (typeof parsed.capacity === "number" && Number.isFinite(parsed.capacity)) return parsed.capacity;
    } catch {
      // A malformed driver payload is not a capacity value.
    }
  }
  throw new TeamRebalanceError(`Authoritative workload has no capacity for ${row.userId}`, 503, "WORKLOAD_DATA_UNAVAILABLE");
}

function allocationMap(rows: Array<{ userId: string; hours: number }>): Map<string, number> {
  return new Map(rows.map((row) => [row.userId, row.hours]));
}

async function buildRebalanceProposal(input: RebalanceInput, context: RebalanceCapabilityContext) {
  const task: any = await prisma.task.findFirst({
    where: { id: input.taskId, isPrivate: false },
    select: {
      id: true,
      title: true,
      dueAt: true,
      effortHours: true,
      aiEffortHours: true,
      actualHours: true,
      status: true,
      updatedAt: true,
      assignments: { select: { userId: true, plannedShare: true } },
    },
  });
  if (!task) throw new TeamRebalanceError("Task not found", 404, "NOT_FOUND");

  const activeUsers = await users();
  if (!activeUsers.some((user: any) => user.id === input.targetUserId)) throw new TeamRebalanceError("Target user is not active", 400, "INVALID_REFERENCE");
  if (input.expectedUpdatedAt && task.updatedAt && timestamp(task.updatedAt, "task version") !== timestamp(input.expectedUpdatedAt, "task version")) {
    throw new TeamRebalanceError("Task was modified by someone else", 409, "VERSION_CONFLICT");
  }

  const workload = await readRebalanceWorkload(context);
  const computedAt = timestamp(workload.computedAt, "computedAt");
  const weekStart = saudiWeekStart(task.dueAt ? new Date(task.dueAt) : context.now);
  const currentAssigneeIds = uniqueIds((task.assignments ?? []).map((assignment: any) => assignment.userId));
  const proposedAssigneeIds = [input.targetUserId];
  const allocationTask: AllocationTask = {
    remainingEffortHours: effort(task).hours,
    status: String(task.status ?? "TODO"),
  };
  const currentAssignments: AllocationAssignment[] = (task.assignments ?? []).map((assignment: any) => ({
    userId: assignment.userId,
    plannedShare: assignment.plannedShare,
  }));
  const proposedAssignments: AllocationAssignment[] = [{ userId: input.targetUserId, plannedShare: input.proposedShare ?? 1 }];
  const currentTaskAllocation = allocationMap(allocateTaskEffort(allocationTask, currentAssignments).allocations);
  const proposedTaskAllocation = allocationMap(allocateTaskEffort(allocationTask, proposedAssignments).allocations);
  const candidateIds = uniqueIds([...currentAssigneeIds, ...proposedAssigneeIds]);
  const usersById = new Map(activeUsers.map((user: any) => [user.id, user]));

  const allocations = candidateIds.map((userId) => {
    const snapshot = rowForUser(workload, userId, weekStart);
    const currentAllocatedHours = snapshot.loadHours;
    const proposedAllocatedHours = currentAllocatedHours - (currentTaskAllocation.get(userId) ?? 0) + (proposedTaskAllocation.get(userId) ?? 0);
    const user = usersById.get(userId);
    const displayName = user ? display(user) : "(inactive)";
    return {
      person: displayName,
      userId,
      displayName,
      currentAllocatedHours,
      proposedAllocatedHours,
      delta: proposedAllocatedHours - currentAllocatedHours,
    };
  });

  const sourceId = currentAssigneeIds[0] ?? input.targetUserId;
  const sourceSnapshot = rowForUser(workload, sourceId, weekStart);
  const targetSnapshot = rowForUser(workload, input.targetUserId, weekStart);
  const targetAllocation = allocations.find((row) => row.userId === input.targetUserId)!;
  const targetCapacity = capacityForRow(targetSnapshot);
  const warnings = [
    "Proposal only; explicit approval is required before tasks.reassign runs.",
    "Allocation hours are grounded in the authoritative workload service and workload/allocation rules.",
    "Acceptance is bound to the preview inputVersion and computedAt; review again if either changes.",
  ];
  if (input.dueDate || input.dueAt) warnings.push("Deadline changes require a separate explicitly approved action.");

  return {
    proposed: true as const,
    taskId: task.id,
    taskTitle: task.title,
    currentAssigneeIds,
    proposedAssigneeIds,
    weekStart: iso(weekStart),
    inputVersion: workload.inputVersion,
    computedAt,
    ...(workload.calendarVersion ? { calendarVersion: workload.calendarVersion } : {}),
    allocations,
    before: { loadHours: sourceSnapshot.loadHours, capacityHours: capacityForRow(sourceSnapshot), loadPercent: sourceSnapshot.loadPercent },
    after: { loadHours: targetAllocation.proposedAllocatedHours, capacityHours: targetCapacity, loadPercent: loadPercentForCapacity(targetAllocation.proposedAllocatedHours, targetCapacity) },
    warnings,
    steps: [{ capability: "tasks.reassign" as const, index: 0, input: { id: task.id, assigneeIds: proposedAssigneeIds }, reason: "Move to the explicitly selected active target without changing the task deadline; allocation version is checked at acceptance.", confidence: "low" as const }],
  };
}

export async function acceptTeamRebalance(input: RebalanceInput, context: CapabilityContext) {
  if (!input.inputVersion || !input.computedAt) throw new TeamRebalanceError("Acceptance requires the inputVersion and computedAt from the reviewed preview", 409, "ACCEPTANCE_VERSION_REQUIRED");
  const proposal = await buildRebalanceProposal(input, context as RebalanceCapabilityContext);
  if (proposal.inputVersion !== input.inputVersion || proposal.computedAt !== timestamp(input.computedAt, "computedAt") || (input.calendarVersion !== undefined && proposal.calendarVersion !== input.calendarVersion)) {
    throw new TeamRebalanceError("The workload allocation changed after this preview; review the rebalance again before accepting", 409, "VERSION_CONFLICT");
  }
  if (input.dueDate || input.dueAt) throw new TeamRebalanceError("Rebalance acceptance changes assignees only; deadline changes require a separate explicitly approved action", 409, "DEADLINE_CHANGE_REQUIRES_SEPARATE_APPROVAL");
  await reassignTask(input.taskId, [input.targetUserId], context.actor);
  return { ...proposal, accepted: true as const };
}

export const teamProposeRebalanceCapability=defineCapability({name:"team.proposeRebalance",version:1,module:"team",description:"Propose a reviewed task reassignment without executing it.",risk:"SENSITIVE_WRITE",requiresExplicitApproval:true,inputSchema:rebalanceInput,outputSchema:rebalanceOutput,async available(a){return write(a);},async authorize(_i,c){if(!write(c.actor)||(!(["ADMIN","LEAD"] as string[]).includes(c.actor.role)))throw Object.assign(new Error("Only leads or admins may propose rebalances"),{status:403,code:"FORBIDDEN"});},async preview(i,c){const proposal=await buildRebalanceProposal(i,c as RebalanceCapabilityContext);return {title:`Propose reassignment for ${i.taskId}`,fields:[{path:"targetUserId",proposed:i.targetUserId},{path:"allocations",proposed:proposal.allocations,source:"authoritative workload service"},{path:"inputVersion",proposed:proposal.inputVersion,source:"authoritative workload service"},{path:"computedAt",proposed:proposal.computedAt,source:"authoritative workload service"},{path:"calendarVersion",proposed:proposal.calendarVersion,source:"authoritative workload service"}],warnings:proposal.warnings};},async execute(i,c){if(i.inputVersion===undefined&&i.computedAt===undefined&&i.calendarVersion===undefined)return buildRebalanceProposal(i,c as RebalanceCapabilityContext);return acceptTeamRebalance(i,c);},async verify(o){return o;},summarize(o){return `${o.accepted?"Accepted":"Proposed"} reassignment for ${o.taskTitle}; ${o.accepted?"task command executed":"approval required"}.`;}});

export const TEAM_CAPABILITIES=[teamMembersCapability,teamCapacityCapability,teamAssignmentCandidatesCapability,teamProposeRebalanceCapability] as const;
export const TEAM_CAPABILITY_NAMES=TEAM_CAPABILITIES.map(c=>c.name);
export function registerTeamCapabilities(registry:{register:(definition:unknown)=>void}){TEAM_CAPABILITIES.forEach(c=>registry.register(c));}
