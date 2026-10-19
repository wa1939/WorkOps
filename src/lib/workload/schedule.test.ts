import { describe, expect, it } from 'vitest';
import { scheduleTasks, spreadAcrossDays } from './schedule';

const calendarOpts = {
  dailyHours: 4,
  leave: [],
  recurring: [],
};

describe('workload schedule', () => {
  it('overdue backlog is not scheduled automatically', () => {
    const result = scheduleTasks(
      [{
        id: 'overdue-task',
        remainingHours: 6,
        plannedStartAt: '2025-12-28T00:00:00+03:00',
        plannedEndAt: '2026-01-03T23:59:59+03:00',
      }],
      {
        startAt: '2026-01-04T00:00:00+03:00',
        endAt: '2026-01-08T23:59:59+03:00',
      },
      calendarOpts,
    );

    expect(result).toEqual({ scheduled: [], backlog: ['overdue-task'] });
  });

  it('zero workdays returns unscheduled', () => {
    expect(spreadAcrossDays(6, [
      { datePart: '2026-01-02', capacityHours: 0 },
      { datePart: '2026-01-03', capacityHours: 0 },
    ])).toEqual({ allocations: [], unscheduledHours: 6 });

    const result = scheduleTasks(
      [{
        id: 'weekend-task',
        remainingHours: 6,
        plannedStartAt: '2026-01-02T00:00:00+03:00',
        plannedEndAt: '2026-01-03T23:59:59+03:00',
      }],
      {
        startAt: '2026-01-02T00:00:00+03:00',
        endAt: '2026-01-03T23:59:59+03:00',
      },
      calendarOpts,
    );

    expect(result).toEqual({ scheduled: [], backlog: ['weekend-task'] });
  });

  it('known effort spreads across working days only', () => {
    const result = scheduleTasks(
      [{
        id: 'planned-task',
        remainingHours: 10,
        plannedStartAt: '2026-01-04T00:00:00+03:00',
        plannedEndAt: '2026-01-08T23:59:59+03:00',
      }],
      {
        startAt: '2026-01-04T00:00:00+03:00',
        endAt: '2026-01-08T23:59:59+03:00',
      },
      calendarOpts,
    );

    expect(result.scheduled).toEqual([
      { id: 'planned-task', datePart: '2026-01-04', hours: 4 },
      { id: 'planned-task', datePart: '2026-01-05', hours: 4 },
      { id: 'planned-task', datePart: '2026-01-06', hours: 2 },
    ]);
    expect(result.scheduled.reduce((total, allocation) => total + allocation.hours, 0)).toBe(10);
    expect(result.backlog).toEqual([]);
  });

  it('undated tasks remain in backlog', () => {
    const result = scheduleTasks(
      [{ id: 'undated-task', remainingHours: 4 }],
      {
        startAt: '2026-01-04T00:00:00+03:00',
        endAt: '2026-01-08T23:59:59+03:00',
      },
      calendarOpts,
    );

    expect(result).toEqual({ scheduled: [], backlog: ['undated-task'] });
  });
});
