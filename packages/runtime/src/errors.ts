import { FluoError, formatTokenName } from '@fluojs/core';

/**
 * Public lifecycle operations supported by {@link PlatformLifecycleConflictError}.
 */
export type PlatformLifecycleOperation = 'start' | 'stop';

/**
 * Error returned when a platform shell lifecycle request overlaps an active transition.
 *
 * @remarks
 * Platform shell lifecycle transitions are strictly exclusive. Callers can inspect
 * {@link PlatformLifecycleConflictError.activeOperation} and
 * {@link PlatformLifecycleConflictError.requestedOperation}, wait for their own active
 * operation to settle, and then retry explicitly.
 */
export class PlatformLifecycleConflictError extends FluoError {
  /** Lifecycle operation that currently owns the platform shell transition. */
  readonly activeOperation: PlatformLifecycleOperation;
  /** Lifecycle operation rejected because another transition is active. */
  readonly requestedOperation: PlatformLifecycleOperation;

  /**
   * Creates a platform lifecycle conflict error.
   *
   * @param activeOperation Lifecycle operation that currently owns the transition.
   * @param requestedOperation Overlapping lifecycle operation that was rejected.
   */
  constructor(activeOperation: PlatformLifecycleOperation, requestedOperation: PlatformLifecycleOperation) {
    super(
      `Cannot ${requestedOperation} the platform shell while ${activeOperation} is active.`,
      {
        code: 'PLATFORM_LIFECYCLE_CONFLICT',
        meta: { activeOperation, requestedOperation },
      },
    );
    this.activeOperation = activeOperation;
    this.requestedOperation = requestedOperation;
  }
}

/**
 * Structured context for runtime-level errors.
 */
export interface RuntimeErrorContext {
  /** Name of the module where the error occurred. */
  readonly module?: string;
  /** DI token associated with the failure. */
  readonly token?: unknown;
  /** Application bootstrap or lifecycle phase. */
  readonly phase?: string;
  /** Actionable hint for resolving the error. */
  readonly hint?: string;
}

function formatRuntimeContext(ctx?: RuntimeErrorContext): string {
  if (!ctx) return '';

  const parts: string[] = [];

  if (ctx.module) {
    parts.push(`Module: ${ctx.module}`);
  }

  if (ctx.token !== undefined) {
    parts.push(`Token: ${formatTokenName(ctx.token)}`);
  }

  if (ctx.phase) {
    parts.push(`Phase: ${ctx.phase}`);
  }

  if (ctx.hint) {
    parts.push(`Hint: ${ctx.hint}`);
  }

  if (parts.length === 0) return '';

  return '\n  ' + parts.join('\n  ');
}

function buildRuntimeMeta(context: RuntimeErrorContext): Record<string, unknown> {
  const meta: Record<string, unknown> = {};

  if (context.module) meta['module'] = context.module;
  if (context.token !== undefined) meta['token'] = formatTokenName(context.token);
  if (context.phase) meta['phase'] = context.phase;
  if (context.hint) meta['hint'] = context.hint;

  return meta;
}

/**
 * Error thrown when a failure occurs during module graph compilation or resolution.
 */
export class ModuleGraphError extends FluoError {
  constructor(message: string, context?: RuntimeErrorContext) {
    super(
      message + formatRuntimeContext(context),
      {
        code: 'MODULE_GRAPH_ERROR',
        ...(context ? { meta: buildRuntimeMeta(context) } : undefined),
      },
    );
  }
}

/**
 * Error thrown when a provider is requested from a module that does not have visibility to it.
 */
export class ModuleVisibilityError extends FluoError {
  constructor(message: string, context?: RuntimeErrorContext) {
    super(
      message + formatRuntimeContext(context),
      {
        code: 'MODULE_VISIBILITY_ERROR',
        ...(context ? { meta: buildRuntimeMeta(context) } : undefined),
      },
    );
  }
}

/**
 * Error thrown when module injection metadata is missing or invalid.
 */
export class ModuleInjectionMetadataError extends FluoError {
  constructor(message: string, context?: RuntimeErrorContext) {
    super(
      message + formatRuntimeContext(context),
      {
        code: 'MODULE_INJECTION_METADATA_ERROR',
        ...(context ? { meta: buildRuntimeMeta(context) } : undefined),
      },
    );
  }
}

/**
 * Error thrown when multiple providers are registered for the same token within a module.
 */
export class DuplicateProviderError extends FluoError {
  constructor(message: string, context?: RuntimeErrorContext) {
    super(
      message + formatRuntimeContext(context),
      {
        code: 'DUPLICATE_PROVIDER_ERROR',
        ...(context ? { meta: buildRuntimeMeta(context) } : undefined),
      },
    );
  }
}
