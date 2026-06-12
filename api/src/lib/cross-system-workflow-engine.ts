/**
 * Generic resumable workflow engine for cross-system mutations.
 *
 * Provides runMutationWorkflow and three opinionated workflow variants:
 * runLocalFirstMutationWorkflow (write CP DB first, then sync to OpenPath),
 * runUpstreamFirstProvisioningWorkflow (create in OpenPath first, then link
 * locally), and runDeleteMutationWorkflow (delete locally, then mark complete).
 *
 * Consumed by every service that performs cross-system writes, such as
 * api/src/services/group-write.service.ts and
 * api/src/services/organization-write.service.ts.
 *
 * Non-obvious constraint: step skipping is determined by comparing the
 * persisted currentStep against a hard-coded step-order array -- if a new
 * step is inserted between existing steps the step-order array in the
 * relevant workflow function must be updated, or already-in-progress operations
 * will re-run steps they have already completed.
 */
import type {
  CrossSystemMutationStatus,
  CrossSystemMutationStep,
  MutationOperationRecord,
} from './cross-system-mutations.js';
import { setMutationOperationProgress, toMutationError } from './cross-system-mutations.js';

type WorkflowStateUpdate<TState> = TState | ((current: TState) => TState);

export interface MutationWorkflowContext<
  TResult extends Record<string, unknown>,
  TState,
  TMetadata extends Record<string, unknown>,
> {
  operation: MutationOperationRecord;
  result: TResult | null;
  state: TState;
  metadata: TMetadata;
}

export interface MutationWorkflowStepUpdate<
  TResult extends Record<string, unknown>,
  TState,
  TMetadata extends Record<string, unknown>,
> {
  completed?: boolean;
  metadata?: Partial<TMetadata>;
  organizationId?: string | null;
  result?: TResult;
  state?: WorkflowStateUpdate<TState>;
  status?: CrossSystemMutationStatus;
  step?: CrossSystemMutationStep;
  userId?: string | null;
}

export interface MutationWorkflowStepDefinition<
  TResult extends Record<string, unknown>,
  TState,
  TMetadata extends Record<string, unknown>,
> {
  completed?: boolean;
  run: (
    context: MutationWorkflowContext<TResult, TState, TMetadata>
  ) => Promise<void | MutationWorkflowStepUpdate<TResult, TState, TMetadata>>;
  shouldRun?: (context: MutationWorkflowContext<TResult, TState, TMetadata>) => boolean;
  status?: CrossSystemMutationStatus;
  step: CrossSystemMutationStep;
}

type MutationWorkflowStepRunner<
  TResult extends Record<string, unknown>,
  TState,
  TMetadata extends Record<string, unknown>,
> = (
  context: MutationWorkflowContext<TResult, TState, TMetadata>
) => Promise<void | MutationWorkflowStepUpdate<TResult, TState, TMetadata>>;

interface MutationWorkflowFamilyParams<
  TResult extends Record<string, unknown>,
  TState,
  TMetadata extends Record<string, unknown>,
> {
  initialResult: TResult | null;
  initialState: TState;
  metadata: TMetadata;
  operation: MutationOperationRecord;
}

export interface LocalFirstMutationWorkflowParams<
  TResult extends Record<string, unknown>,
  TState,
  TMetadata extends Record<string, unknown>,
> extends MutationWorkflowFamilyParams<TResult, TState, TMetadata> {
  commitLocal: MutationWorkflowStepRunner<TResult, TState, TMetadata>;
  localCommitProof?: 'result' | 'current-step';
  complete: MutationWorkflowStepRunner<TResult, TState, TMetadata>;
  syncUpstream: MutationWorkflowStepRunner<TResult, TState, TMetadata>;
}

export interface UpstreamFirstProvisioningWorkflowParams<
  TResult extends Record<string, unknown>,
  TState,
  TMetadata extends Record<string, unknown>,
> extends MutationWorkflowFamilyParams<TResult, TState, TMetadata> {
  complete: MutationWorkflowStepRunner<TResult, TState, TMetadata>;
  createUpstream: MutationWorkflowStepRunner<TResult, TState, TMetadata>;
  linkLocal: MutationWorkflowStepRunner<TResult, TState, TMetadata>;
}

export interface DeleteMutationWorkflowParams<
  TResult extends Record<string, unknown>,
  TState,
  TMetadata extends Record<string, unknown>,
> extends MutationWorkflowFamilyParams<TResult, TState, TMetadata> {
  commitLocalDelete: MutationWorkflowStepRunner<TResult, TState, TMetadata>;
  completeDelete: MutationWorkflowStepRunner<TResult, TState, TMetadata>;
}

function mergeWorkflowMetadata<TMetadata extends Record<string, unknown>>(
  current: TMetadata,
  patch: Partial<TMetadata> | undefined
): TMetadata {
  return patch ? { ...current, ...patch } : current;
}

function applyWorkflowStateUpdate<TState>(
  current: TState,
  update: WorkflowStateUpdate<TState> | undefined
): TState {
  if (!update) {
    return current;
  }

  return typeof update === 'function' ? (update as (current: TState) => TState)(current) : update;
}

function hasReachedStep(
  currentStep: string,
  targetStep: CrossSystemMutationStep,
  stepOrder: CrossSystemMutationStep[]
): boolean {
  const currentIndex = stepOrder.indexOf(currentStep as CrossSystemMutationStep);
  const targetIndex = stepOrder.indexOf(targetStep);

  return currentIndex >= 0 && targetIndex >= 0 && currentIndex >= targetIndex;
}

export async function runMutationWorkflow<
  TResult extends Record<string, unknown>,
  TState,
  TMetadata extends Record<string, unknown>,
>(params: {
  initialResult: TResult | null;
  initialState: TState;
  metadata: TMetadata;
  operation: MutationOperationRecord;
  steps: MutationWorkflowStepDefinition<TResult, TState, TMetadata>[];
}): Promise<{ metadata: TMetadata; result: TResult | null; state: TState }> {
  let result = params.initialResult;
  let state = params.initialState;
  let metadata = params.metadata;

  for (const step of params.steps) {
    const context: MutationWorkflowContext<TResult, TState, TMetadata> = {
      operation: params.operation,
      result,
      state,
      metadata,
    };

    if (step.shouldRun && !step.shouldRun(context)) {
      continue;
    }

    try {
      const update = await step.run(context);

      result = update?.result ?? result;
      state = applyWorkflowStateUpdate(state, update?.state);
      metadata = mergeWorkflowMetadata(metadata, update?.metadata);

      await setMutationOperationProgress(params.operation.id, {
        step: update?.step ?? step.step,
        status:
          update?.status ??
          (update?.completed || step.completed ? 'completed' : (step.status ?? 'in_progress')),
        organizationId: update?.organizationId,
        userId: update?.userId,
        metadata,
        result: result ?? undefined,
        lastError: null,
        completed: update?.completed ?? step.completed ?? false,
      });
    } catch (error) {
      await setMutationOperationProgress(params.operation.id, {
        step: 'failed',
        status: 'failed',
        metadata,
        result: result ?? undefined,
        lastError: toMutationError(error),
      });
      throw error;
    }
  }

  return { metadata, result, state };
}

export async function runLocalFirstMutationWorkflow<
  TResult extends Record<string, unknown>,
  TState,
  TMetadata extends Record<string, unknown>,
>(
  params: LocalFirstMutationWorkflowParams<TResult, TState, TMetadata>
): Promise<{ metadata: TMetadata; result: TResult | null; state: TState }> {
  const stepOrder: CrossSystemMutationStep[] = [
    'pending',
    'local_committed',
    'synced_upstream',
    'completed',
  ];
  const localCommitProof = params.localCommitProof ?? 'result';

  return runMutationWorkflow({
    operation: params.operation,
    initialResult: params.initialResult,
    initialState: params.initialState,
    metadata: params.metadata,
    steps: [
      {
        step: 'local_committed',
        shouldRun: ({ result }) =>
          localCommitProof === 'result'
            ? !result
            : !hasReachedStep(params.operation.currentStep, 'local_committed', stepOrder),
        run: params.commitLocal,
      },
      {
        step: 'synced_upstream',
        shouldRun: ({ result }) =>
          Boolean(result) &&
          !hasReachedStep(params.operation.currentStep, 'synced_upstream', stepOrder),
        run: params.syncUpstream,
      },
      {
        step: 'completed',
        completed: true,
        shouldRun: ({ result }) => Boolean(result),
        run: params.complete,
      },
    ],
  });
}

export async function runUpstreamFirstProvisioningWorkflow<
  TResult extends Record<string, unknown>,
  TState,
  TMetadata extends Record<string, unknown>,
>(
  params: UpstreamFirstProvisioningWorkflowParams<TResult, TState, TMetadata>
): Promise<{ metadata: TMetadata; result: TResult | null; state: TState }> {
  const stepOrder: CrossSystemMutationStep[] = [
    'pending',
    'upstream_created',
    'local_linked',
    'completed',
  ];

  return runMutationWorkflow({
    operation: params.operation,
    initialResult: params.initialResult,
    initialState: params.initialState,
    metadata: params.metadata,
    steps: [
      {
        step: 'upstream_created',
        shouldRun: ({ result }) => !result,
        run: params.createUpstream,
      },
      {
        step: 'local_linked',
        shouldRun: ({ result }) =>
          Boolean(result) &&
          !hasReachedStep(params.operation.currentStep, 'local_linked', stepOrder),
        run: params.linkLocal,
      },
      {
        step: 'completed',
        completed: true,
        shouldRun: ({ result }) => Boolean(result),
        run: params.complete,
      },
    ],
  });
}

export async function runDeleteMutationWorkflow<
  TResult extends Record<string, unknown>,
  TState,
  TMetadata extends Record<string, unknown>,
>(
  params: DeleteMutationWorkflowParams<TResult, TState, TMetadata>
): Promise<{ metadata: TMetadata; result: TResult | null; state: TState }> {
  return runMutationWorkflow({
    operation: params.operation,
    initialResult: params.initialResult,
    initialState: params.initialState,
    metadata: params.metadata,
    steps: [
      {
        step: 'local_committed',
        shouldRun: ({ result }) => !result,
        run: params.commitLocalDelete,
      },
      {
        step: 'completed',
        completed: true,
        shouldRun: ({ result }) => Boolean(result),
        run: params.completeDelete,
      },
    ],
  });
}
