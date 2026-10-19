import { describe, expect, it } from 'vitest';
import { computePersonBudget } from './service';

describe('computePersonBudget', () => {
  it('two workspaces share one capacity budget', () => {
    const budget = computePersonBudget(
      {
        userId: 'person-1',
        canonicalUserId: 'person-1',
        capacityHoursPerWeek: 20,
        commitments: [
          {
            workspaceId: 'workspace-1',
            allocatedHours: 6,
            source: 'task',
            taskId: 'task-1',
            title: 'Public work',
          },
          {
            workspaceId: 'workspace-2',
            allocatedHours: 5,
            source: 'task',
            taskId: 'task-2',
            title: 'Other work',
          },
        ],
      },
      { canSeeDetailsOf: () => true, viewerId: 'viewer-1' },
    );

    expect(budget.totalAllocatedHours).toBe(11);
    expect(budget.capacityHoursPerWeek).toBe(20);
    expect(budget.percent).toBe(55);
    expect(budget.state).toBe('available');
    expect(budget.perWorkspace).toEqual([
      {
        workspaceId: 'workspace-1',
        allocatedHours: 6,
        detailLevel: 'full',
        items: [{ taskId: 'task-1', title: 'Public work' }],
      },
      {
        workspaceId: 'workspace-2',
        allocatedHours: 5,
        detailLevel: 'full',
        items: [{ taskId: 'task-2', title: 'Other work' }],
      },
    ]);
  });

  it('private external commitments reveal no titles', () => {
    const budget = computePersonBudget(
      {
        userId: 'person-1',
        canonicalUserId: 'person-1',
        capacityHoursPerWeek: 20,
        commitments: [
          {
            workspaceId: 'workspace-1',
            allocatedHours: 6,
            source: 'task',
            taskId: 'task-1',
            title: 'Visible work',
          },
          {
            workspaceId: 'workspace-2',
            allocatedHours: 5,
            source: 'task',
            taskId: 'secret-task',
            title: 'Secret external commitment',
            isPrivate: true,
          },
        ],
      },
      {
        canSeeDetailsOf: (workspaceId) => workspaceId === 'workspace-1',
        viewerId: 'viewer-1',
      },
    );

    expect(budget.perWorkspace).toEqual([
      {
        workspaceId: 'workspace-1',
        allocatedHours: 6,
        detailLevel: 'full',
        items: [{ taskId: 'task-1', title: 'Visible work' }],
      },
      {
        workspaceId: 'workspace-2',
        allocatedHours: 5,
        detailLevel: 'aggregate',
        items: [],
      },
    ]);
    expect(JSON.stringify(budget)).not.toContain('Secret external commitment');
    expect(JSON.stringify(budget)).not.toContain('secret-task');
  });

  it('identity aliases do not add capacity', () => {
    const budget = computePersonBudget(
      {
        userId: 'alias-a',
        canonicalUserId: 'canonical-person',
        capacityHoursPerWeek: 10,
        commitments: [
          {
            workspaceId: 'workspace-1',
            allocatedHours: 4,
            source: 'task',
            taskId: 'same-task',
            title: 'Lower duplicate',
          },
          {
            workspaceId: 'workspace-1',
            allocatedHours: 6,
            source: 'task',
            taskId: 'same-task',
            title: 'Higher duplicate',
          },
        ],
      },
      { canSeeDetailsOf: () => true, viewerId: 'viewer-1' },
    );

    expect(budget.canonicalUserId).toBe('canonical-person');
    expect(budget.totalAllocatedHours).toBe(6);
    expect(budget.percent).toBe(60);
    expect(budget.perWorkspace).toEqual([
      {
        workspaceId: 'workspace-1',
        allocatedHours: 6,
        detailLevel: 'full',
        items: [{ taskId: 'same-task', title: 'Higher duplicate' }],
      },
    ]);
  });
});
