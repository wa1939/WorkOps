import type {
    PlannerMember,
    PlannerMemberDay,
    PlannerProjectDay,
    PlannerTaskChip,
} from "@/lib/workload/planner-read-model";
import type { PlannerRange } from "./range-utils";
import type { PlannedDateRange } from "./interactions/planner-math";

export type PlannerTeamTotalDay = PlannerProjectDay & {
    capacityHours?: number;
    availableHours?: number;
    utilizationPercent: number | null;
};

export type PlannerTeamTotal = {
    days: PlannerTeamTotalDay[];
    periodUtilizationPercent?: number | null;
};

export type PlannerProjectAxisRow = {
    projectId: string;
    projectName?: string | null;
    name?: string | null;
    days: PlannerProjectDay[];
    totalAllocatedHours?: number;
};

export type PlannerBacklogItem = {
    taskId: string;
    taskKey: string | null;
    title: string;
    reason: string;
    hours?: number | null;
    projectId?: string | null;
    projectName?: string | null;
};

export type PlannerApiPayload = {
    members: PlannerMember[];
    projectAxis: PlannerProjectAxisRow[];
    teamTotal: PlannerTeamTotal;
    backlog: PlannerBacklogItem[];
    unknownEffortCount: number;
};

export type PlannerDateColumn = {
    datePart: string;
    label: string;
    weekday: string;
    isWeekend: boolean;
};

export type PlannerProjectTaskChip = PlannerTaskChip & {
    memberId: string;
    memberName: string;
    memberImage: string | null;
};

export type PlannerProjectDisplayRow = {
    projectId: string;
    projectName: string;
    days: PlannerProjectDay[];
    chipsByDate: Record<string, PlannerProjectTaskChip[]>;
};

export type PlannerTaskDragData = {
    type: "task";
    taskId: string;
    sourceMemberId: string;
    sourceDate: string;
    chip: PlannerTaskChip;
};

export type PlannerDropTarget =
    | { type: "cell"; memberId: string; datePart: string }
    | { type: "member"; memberId: string };

export type PlannerResizeRequest =
    | {
          kind: "estimate";
          taskId: string;
          hours: number;
      }
    | {
          kind: "date";
          taskId: string;
          edge: "start" | "end";
          range: PlannedDateRange;
      };

export type PlannerGridProps = {
    data: PlannerApiPayload;
    range: PlannerRange;
    dateColumns: PlannerDateColumn[];
    projectRows: PlannerProjectDisplayRow[];
    getTaskEstimateHours: (taskId: string) => number;
    getTaskPlannedRange: (taskId: string) => PlannedDateRange;
    onEmptyCell: (memberId: string, datePart: string) => void;
    onTaskContextMenu: (event: React.MouseEvent, taskId: string, memberId: string, datePart: string) => void;
    onDrop: (drag: PlannerTaskDragData, target: PlannerDropTarget) => void;
    onResize: (request: PlannerResizeRequest) => void;
};

export type PlannerMemberRowProps = {
    member: PlannerMember;
    dateColumns: PlannerDateColumn[];
    gridDateParts: readonly string[];
    gridTemplateColumns: string;
    range: PlannerRange;
    getTaskEstimateHours: (taskId: string) => number;
    getTaskPlannedRange: (taskId: string) => PlannedDateRange;
    onEmptyCell: (memberId: string, datePart: string) => void;
    onTaskContextMenu: (event: React.MouseEvent, taskId: string, memberId: string, datePart: string) => void;
    onResize: (request: PlannerResizeRequest) => void;
};

export type PlannerCellProps = {
    memberId: string;
    memberName: string;
    datePart: string;
    day: PlannerMemberDay;
    gridDateParts: readonly string[];
    getTaskEstimateHours: (taskId: string) => number;
    getTaskPlannedRange: (taskId: string) => PlannedDateRange;
    onEmptyCell: (memberId: string, datePart: string) => void;
    onTaskContextMenu: (event: React.MouseEvent, taskId: string, memberId: string, datePart: string) => void;
    onResize: (request: PlannerResizeRequest) => void;
};
