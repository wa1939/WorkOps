export type TimelineStageProgress = {
    total: number;
    planned: number;
    active: number;
    complete: number;
    blocked: number;
    completed: number;
    percent: number;
};

export type TimelineTaskProgress = {
    total: number;
    done: number;
    percent: number;
};

export type TimelineProject = {
    id: string;
    name: string;
    status: string;
    health: string;
    startAt: string | null;
    dueAt: string | null;
    dueAtEnd: string | null;
    updatedAt: string;
    stageProgress: TimelineStageProgress;
    taskProgress: TimelineTaskProgress;
};

export type TimelineResponse = {
    projects: TimelineProject[];
    minDate: string | null;
    maxDate: string | null;
};

export type ProjectDates = {
    start: Date;
    /** Effective visible end: dueAtEnd when present, otherwise dueAt. */
    end: Date;
    dueAt: Date;
    dueAtEnd: Date | null;
};

export type InteractionMode = "move" | "resize-start" | "resize-end";
