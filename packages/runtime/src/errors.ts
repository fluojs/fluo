import { KonektiError, formatTokenName } from '@fluojs/core';

export interface RuntimeErrorContext {
  readonly module?: string;
  readonly token?: unknown;
  readonly phase?: string;
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

export class ModuleGraphError extends KonektiError {
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

export class ModuleVisibilityError extends KonektiError {
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

export class ModuleInjectionMetadataError extends KonektiError {
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

export class DuplicateProviderError extends KonektiError {
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
