import { describe, expect, it } from 'vitest';
import { summarizeWorkload } from './summary';

describe('workload summary', () => {
  it('keeps uncapped load and unknown effort separate', () => {
    expect(summarizeWorkload([70, 35], 35)).toEqual({
      plannedHours: 105,
      capacityHours: 35,
      unknownTasks: 0,
      percent: 300,
      state: 'overloaded',
    });
    expect(summarizeWorkload([null], 35)).toMatchObject({
      unknownTasks: 1,
      state: 'unestimated',
    });
  });

  it('does not invent a percentage with no capacity', () => {
    expect(summarizeWorkload([5], 0)).toMatchObject({
      percent: null,
      state: 'no-capacity',
    });
  });

  it('rejects invalid effort', () => {
    expect(() => summarizeWorkload([-1], 35)).toThrow(RangeError);
    expect(() => summarizeWorkload([Number.NaN], 35)).toThrow(RangeError);
  });
});
