export type WorkloadSummary = {
  plannedHours: number;
  capacityHours: number;
  unknownTasks: number;
  percent: number | null;
  state: 'unestimated' | 'no-capacity' | 'available' | 'booked' | 'overloaded';
};

export function summarizeWorkload(
  efforts: readonly (number | null)[],
  capacityHours: number,
): WorkloadSummary {
  if (!Number.isFinite(capacityHours) || capacityHours < 0) {
    throw new RangeError('Capacity must be finite and nonnegative');
  }

  let plannedHours = 0;
  let unknownTasks = 0;

  for (const effort of efforts) {
    if (effort === null) {
      unknownTasks++;
    } else if (!Number.isFinite(effort) || effort < 0) {
      throw new RangeError('Effort must be finite and nonnegative');
    } else {
      plannedHours += effort;
    }
  }

  const percent = capacityHours > 0
    ? Math.round(plannedHours / capacityHours * 100)
    : null;
  const state = capacityHours === 0
    ? 'no-capacity'
    : unknownTasks > 0
      ? 'unestimated'
      : plannedHours > capacityHours
        ? 'overloaded'
        : plannedHours === capacityHours
          ? 'booked'
          : 'available';

  return {
    plannedHours,
    capacityHours,
    unknownTasks,
    percent,
    state,
  };
}
