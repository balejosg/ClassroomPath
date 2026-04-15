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
