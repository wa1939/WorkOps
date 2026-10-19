import { summarizeWorkload, type WorkloadSummary } from './summary';

export type PersonBudgetCommitment = {
  workspaceId: string;
  allocatedHours: number;
  source: 'task';
  taskId?: string;
  title?: string;
  isPrivate?: boolean;
};

export type PersonBudgetInput = {
  userId: string;
  canonicalUserId: string;
  commitments: Array<PersonBudgetCommitment>;
  capacityHoursPerWeek: number;
};

export type PersonBudget = {
  canonicalUserId: string;
  totalAllocatedHours: number;
  capacityHoursPerWeek: number;
  percent: number | null;
  state: WorkloadSummary['state'];
  perWorkspace: Array<{
    workspaceId: string;
    allocatedHours: number;
    detailLevel: 'full' | 'aggregate';
    items: Array<{ taskId: string; title: string }>;
  }>;
};

export type PersonBudgetOptions = {
  canSeeDetailsOf: (workspaceId: string, viewerId: string) => boolean;
  viewerId: string;
};

type SelectedCommitment = PersonBudgetCommitment & {
  allocatedHours: number | null;
};

function selectCommitments(commitments: PersonBudgetCommitment[]): SelectedCommitment[] {
  const highestByTask = new Map<string, PersonBudgetCommitment>();

  for (const commitment of commitments) {
    if (commitment.taskId === undefined) continue;

    const current = highestByTask.get(commitment.taskId);
    if (current === undefined || commitment.allocatedHours > current.allocatedHours) {
      highestByTask.set(commitment.taskId, commitment);
    }
  }

  return commitments.filter((commitment) => {
    if (commitment.taskId === undefined) return true;
    return highestByTask.get(commitment.taskId) === commitment;
  });
}

export function computePersonBudget(
  input: PersonBudgetInput,
  opts: PersonBudgetOptions,
): PersonBudget {
  const selectedCommitments = selectCommitments(input.commitments);
  const summary = summarizeWorkload(
    selectedCommitments.map((commitment) => commitment.allocatedHours),
    input.capacityHoursPerWeek,
  );
  const workspaceTotals = new Map<string, {
    allocatedHours: number;
    items: Array<{ taskId: string; title: string }>;
  }>();

  for (const commitment of selectedCommitments) {
    const workspace = workspaceTotals.get(commitment.workspaceId) ?? {
      allocatedHours: 0,
      items: [],
    };
    if (commitment.allocatedHours !== null) {
      workspace.allocatedHours += commitment.allocatedHours;
    }
    if (commitment.taskId !== undefined && commitment.title !== undefined) {
      workspace.items.push({ taskId: commitment.taskId, title: commitment.title });
    }
    workspaceTotals.set(commitment.workspaceId, workspace);
  }

  const perWorkspace = Array.from(workspaceTotals, ([workspaceId, workspace]) => {
    const canSeeDetails = opts.canSeeDetailsOf(workspaceId, opts.viewerId);
    return {
      workspaceId,
      allocatedHours: workspace.allocatedHours,
      detailLevel: canSeeDetails ? 'full' as const : 'aggregate' as const,
      items: canSeeDetails ? workspace.items : [],
    };
  });

  return {
    canonicalUserId: input.canonicalUserId,
    totalAllocatedHours: summary.plannedHours,
    capacityHoursPerWeek: input.capacityHoursPerWeek,
    percent: summary.percent,
    state: summary.state,
    perWorkspace,
  };
}
