export type AllocationTask = {
  remainingEffortHours?: number | null;
  estimateHours?: number | null;
  actualHours?: number | null;
  status: string;
};

export type AllocationAssignment = {
  userId: string;
  plannedShare?: number | null;
};

export type EffortAllocation = {
  userId: string;
  hours: number;
};

export type EffectiveRemainingEffort = {
  hours: number;
  inferred: boolean;
};

export type TaskEffortAllocation = {
  allocations: EffortAllocation[];
  remaining: EffectiveRemainingEffort | null;
};

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'canceled', 'closed']);
const SHARE_EPSILON = 1e-9;

export function allocateTaskEffort(
  task: AllocationTask,
  assignments: AllocationAssignment[],
): TaskEffortAllocation {
  const remaining = task.remainingEffortHours != null
    ? { hours: task.remainingEffortHours, inferred: false }
    : task.estimateHours != null
      ? {
          hours: Math.max(task.estimateHours - (task.actualHours ?? 0), 0),
          inferred: true,
        }
      : null;

  if (
    remaining === null
    || TERMINAL_STATUSES.has(task.status.trim().toLowerCase())
    || assignments.length === 0
  ) {
    return { allocations: [], remaining };
  }

  const shares = assignments.map((assignment) => assignment.plannedShare);
  const hasProvidedShare = shares.some((share) => share != null);

  let normalizedShares: number[];
  if (!hasProvidedShare) {
    normalizedShares = assignments.map(() => 1 / assignments.length);
  } else {
    let shareTotal = 0;
    for (const share of shares) {
      if (share == null) {
        continue;
      }
      if (!Number.isFinite(share) || share < 0) {
        throw new RangeError('Planned shares must be finite and nonnegative');
      }
      shareTotal += share;
    }

    if (!Number.isFinite(shareTotal) || Math.abs(shareTotal - 1) > SHARE_EPSILON) {
      throw new RangeError('Provided planned shares must sum to 1');
    }

    normalizedShares = shares.map((share) => share ?? 0);
  }

  return {
    allocations: assignments.map((assignment, index) => ({
      userId: assignment.userId,
      hours: remaining.hours * normalizedShares[index],
    })),
    remaining,
  };
}
