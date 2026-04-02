import { KonektiCodeError, formatTokenName } from '@konekti/core';

export interface DiErrorContext {
  readonly token?: unknown;
  readonly scope?: string;
  readonly module?: string;
  readonly dependencyChain?: readonly unknown[];
  readonly hint?: string;
}

function formatDiContext(ctx?: DiErrorContext): string {
  if (!ctx) return '';

  const parts: string[] = [];

  if (ctx.token !== undefined) {
    parts.push(`Token: ${formatTokenName(ctx.token)}`);
  }

  if (ctx.scope) {
    parts.push(`Scope: ${ctx.scope}`);
  }

  if (ctx.module) {
    parts.push(`Module: ${ctx.module}`);
  }

  if (ctx.dependencyChain && ctx.dependencyChain.length > 0) {
    parts.push(`Dependency chain: ${ctx.dependencyChain.map((t) => formatTokenName(t)).join(' -> ')}`);
  }

  if (ctx.hint) {
    parts.push(`Hint: ${ctx.hint}`);
  }

  if (parts.length === 0) return '';

  return '\n  ' + parts.join('\n  ');
}

export class InvalidProviderError extends KonektiCodeError {
  constructor(message: string, context?: DiErrorContext) {
    super(
      message + formatDiContext(context),
      'INVALID_PROVIDER',
      context ? { meta: buildMeta(context) } : undefined,
    );
  }
}

export class ContainerResolutionError extends KonektiCodeError {
  constructor(message: string, context?: DiErrorContext) {
    super(
      message + formatDiContext(context),
      'CONTAINER_RESOLUTION_ERROR',
      context ? { meta: buildMeta(context) } : undefined,
    );
  }
}

export class RequestScopeResolutionError extends KonektiCodeError {
  constructor(message: string, context?: DiErrorContext) {
    super(
      message + formatDiContext(context),
      'REQUEST_SCOPE_RESOLUTION_ERROR',
      context ? { meta: buildMeta(context) } : undefined,
    );
  }
}

export class ScopeMismatchError extends KonektiCodeError {
  constructor(message: string, context?: DiErrorContext) {
    super(
      message + formatDiContext(context),
      'SCOPE_MISMATCH',
      context ? { meta: buildMeta(context) } : undefined,
    );
  }
}

export class CircularDependencyError extends KonektiCodeError {
  constructor(chain: readonly unknown[], detail?: string) {
    const path = chain.map((token) => formatTokenName(token)).join(' -> ');
    const hint = 'Break the cycle by extracting shared logic into a separate provider, or use forwardRef() to defer one side of the dependency.';
    super(
      (detail ? `Circular dependency detected: ${path}. ${detail}` : `Circular dependency detected: ${path}`) +
        `\n  Dependency chain: ${path}` +
        `\n  Hint: ${hint}`,
      'CIRCULAR_DEPENDENCY',
      { meta: { chain: chain.map((t) => formatTokenName(t)), hint } },
    );
  }
}

export class DuplicateProviderError extends KonektiCodeError {
  constructor(token: unknown) {
    const name = formatTokenName(token);
    const hint = 'Use container.override() for intentional overrides, or check for accidental double-registration in your module providers array.';
    super(
      `Token "${name}" is already registered.` +
        `\n  Token: ${name}` +
        `\n  Hint: ${hint}`,
      'DUPLICATE_PROVIDER',
      { meta: { token: name, hint } },
    );
  }
}

function buildMeta(context: DiErrorContext): Record<string, unknown> {
  const meta: Record<string, unknown> = {};

  if (context.token !== undefined) meta['token'] = formatTokenName(context.token);
  if (context.scope) meta['scope'] = context.scope;
  if (context.module) meta['module'] = context.module;
  if (context.dependencyChain) meta['dependencyChain'] = context.dependencyChain.map((t) => formatTokenName(t));
  if (context.hint) meta['hint'] = context.hint;

  return meta;
}
