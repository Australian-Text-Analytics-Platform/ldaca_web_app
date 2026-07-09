interface WorkspaceOperationLifecycleConfig {
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;
  setOperationError: (operationId: string, error: string) => void;
}

type MaybePromise<T> = T | Promise<T>;

const operationErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown operation error';
};

/**
 * Builds TanStack mutation lifecycle callbacks for workspace operations.
 *
 * Used by: workspace graph, transform, analysis, and management mutation hooks
 * because those hooks should keep their domain-specific mutation bodies while
 * sharing operation-state bookkeeping for start, success cleanup, and error
 * reporting.
 *
 * Flow: `onMutate` starts the named operation before any caller-specific
 * optimistic work, `onSuccess` runs caller cache/selection work and always ends
 * the operation, and `onError` runs caller rollback work before storing the
 * operation error and ending the operation.
 */
export const createWorkspaceOperationLifecycle = ({
  startOperation,
  endOperation,
  setOperationError,
}: WorkspaceOperationLifecycleConfig) => {
  function onMutate(operationId: string): () => void;
  function onMutate<TVariables, TContext>(
    operationId: string,
    handler: (variables: TVariables) => MaybePromise<TContext>,
  ): (variables: TVariables) => MaybePromise<TContext>;
  function onMutate<TVariables, TContext>(
    operationId: string,
    handler?: (variables: TVariables) => MaybePromise<TContext>,
  ) {
    return (variables: TVariables) => {
      startOperation(operationId);
      return handler?.(variables);
    };
  }

  const onSuccess =
    <TData, TVariables, TContext>(
      operationId: string,
      handler?: (data: TData, variables: TVariables, context: TContext) => MaybePromise<void>,
    ) =>
    async (data: TData, variables: TVariables, context: TContext) => {
      try {
        await handler?.(data, variables, context);
      } finally {
        endOperation(operationId);
      }
    };

  function onError(
    operationId: string,
  ): (
    error: unknown,
    variables: unknown,
    onMutateResult: unknown,
    context: unknown,
  ) => Promise<void>;
  function onError<TError, TVariables, TOnMutateResult>(
    operationId: string,
    handler: (
      error: TError,
      variables: TVariables,
      onMutateResult: TOnMutateResult | undefined,
    ) => MaybePromise<void>,
  ): (
    error: TError,
    variables: TVariables,
    onMutateResult: TOnMutateResult | undefined,
    context: unknown,
  ) => Promise<void>;
  function onError<TError, TVariables, TOnMutateResult>(
    operationId: string,
    handler?: (
      error: TError,
      variables: TVariables,
      onMutateResult: TOnMutateResult | undefined,
    ) => MaybePromise<void>,
  ) {
    return async (
      error: TError,
      variables: TVariables,
      onMutateResult: TOnMutateResult | undefined,
      _context: unknown,
    ) => {
      try {
        await handler?.(error, variables, onMutateResult);
      } finally {
        setOperationError(operationId, operationErrorMessage(error));
        endOperation(operationId);
      }
    };
  }

  return { onMutate, onSuccess, onError } as const;
};
