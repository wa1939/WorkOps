import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORK_WEEK,
  dayCapacity,
  dateInTimeZone,
  isWorkingDay,
  weekdayOfDatePart,
} from './calendar';

const RIYADH = 'Asia/Riyadh';

const leaveCoveringJanuary5 = {
  startAt: '2026-01-05T00:00:00+03:00',
  endAt: '2026-01-06T00:00:00+03:00',
};

const recurringOnMonday = (hoursPerDay: number) => ({
  hoursPerDay,
  startAt: '2026-01-05T00:00:00+03:00',
  endAt: '2026-01-06T00:00:00+03:00',
  dayOfWeek: 1,
});

describe('workload calendar', () => {
  it('Riyadh midnight assigns correct day', () => {
    expect(dateInTimeZone('2026-01-01T00:00:00+03:00', RIYADH)).toBe('2026-01-01');
    expect(DEFAULT_WORK_WEEK).toEqual([0, 1, 2, 3, 4]);
  });

  it('Friday is not a workday', () => {
    expect(weekdayOfDatePart('2026-01-02', RIYADH)).toBe(5);
    expect(weekdayOfDatePart('2026-01-04', RIYADH)).toBe(0);
    expect(isWorkingDay('2026-01-02', {})).toBe(false);
    expect(isWorkingDay('2026-01-04', {})).toBe(true);
    expect(isWorkingDay('2026-01-04', { weekDays: [1, 2, 3, 4, 5] })).toBe(false);
    expect(isWorkingDay('2026-01-06', { holidays: ['2026-01-06'] })).toBe(false);
  });

  it('leave overlap counted once', () => {
    expect(dayCapacity('2026-01-05', {
      dailyHours: 8,
      leave: [leaveCoveringJanuary5, leaveCoveringJanuary5],
      recurring: [],
    })).toBe(0);
    expect(dayCapacity('2026-01-05', {
      dailyHours: 8,
      leave: [leaveCoveringJanuary5],
      recurring: [],
    })).toBe(0);
    expect(dayCapacity('2026-01-05', {
      dailyHours: 8,
      leave: [],
      recurring: [],
    })).toBe(8);

    expect(dayCapacity('2026-01-05', {
      dailyHours: 8,
      leave: [],
      recurring: [recurringOnMonday(2), recurringOnMonday(3)],
    })).toBe(3);
    expect(dayCapacity('2026-01-05', {
      dailyHours: 4,
      leave: [leaveCoveringJanuary5],
      recurring: [recurringOnMonday(3), recurringOnMonday(3)],
    })).toBe(0);
  });
});
