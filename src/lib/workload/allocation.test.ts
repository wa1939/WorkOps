import { describe, expect, it } from 'vitest';
import { allocateTaskEffort } from './allocation';

describe('task effort allocation', () => {
  it('shared task effort is not multiplied', () => {
    const result = allocateTaskEffort(
      { remainingEffortHours: 10, status: 'in_progress' },
      [{ userId: 'alice' }, { userId: 'bob' }],
    );

    expect(result).toEqual({
      allocations: [
        { userId: 'alice', hours: 5 },
        { userId: 'bob', hours: 5 },
      ],
      remaining: { hours: 10, inferred: false },
    });
    expect(result.allocations.reduce((total, allocation) => total + allocation.hours, 0)).toBe(10);
  });

  it('unknown effort remains unknown', () => {
    expect(
      allocateTaskEffort(
        { status: 'todo' },
        [{ userId: 'alice' }],
      ),
    ).toEqual({ allocations: [], remaining: null });
  });

  it('completed or canceled has no remaining load', () => {
    expect(
      allocateTaskEffort(
        { remainingEffortHours: 10, status: 'completed' },
        [{ userId: 'alice' }],
      ),
    ).toEqual({ allocations: [], remaining: { hours: 10, inferred: false } });
    expect(
      allocateTaskEffort(
        { remainingEffortHours: 10, status: 'CANCELED' },
        [{ userId: 'alice' }],
      ),
    ).toEqual({ allocations: [], remaining: { hours: 10, inferred: false } });
  });

  it('invalid shares rejected', () => {
    const task = { remainingEffortHours: 10, status: 'in_progress' };

    expect(() => allocateTaskEffort(task, [{ userId: 'alice', plannedShare: -0.5 }])).toThrow(RangeError);
    expect(() => allocateTaskEffort(task, [
      { userId: 'alice', plannedShare: 0.6 },
      { userId: 'bob', plannedShare: 0.6 },
    ])).toThrow(RangeError);
    expect(() => allocateTaskEffort(task, [
      { userId: 'alice', plannedShare: 0.5 },
      { userId: 'bob', plannedShare: 0.4 },
    ])).toThrow(RangeError);
  });
});
