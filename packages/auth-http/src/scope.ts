import type { AuthRequirement } from './types.js';

function normalizeScopeItems(items: Iterable<string>): string[] | undefined {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of items) {
    const scope = item.trim();

    if (scope.length === 0 || seen.has(scope)) {
      continue;
    }

    seen.add(scope);
    normalized.push(scope);
  }

  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Normalize declared scopes.
 *
 * @param scopes The scopes.
 * @returns The normalize declared scopes result.
 */
export function normalizeDeclaredScopes(scopes: unknown): string[] | undefined {
  if (!Array.isArray(scopes)) {
    return undefined;
  }

  const scopeItems = scopes.filter((scope): scope is string => typeof scope === 'string');
  return normalizeScopeItems(scopeItems);
}

/**
 * Normalize principal scopes.
 *
 * @param claims The claims.
 * @returns The normalize principal scopes result.
 */
export function normalizePrincipalScopes(claims: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(claims.scopes)) {
    const scopes = claims.scopes.filter((scope): scope is string => typeof scope === 'string');
    return normalizeScopeItems(scopes);
  }

  if (typeof claims.scope === 'string') {
    return normalizeScopeItems(claims.scope.split(/\s+/));
  }

  return undefined;
}

/**
 * Merge auth requirements.
 *
 * @param base The base.
 * @param extra The extra.
 * @returns The merge auth requirements result.
 */
export function mergeAuthRequirements(
  base: AuthRequirement | undefined,
  extra: AuthRequirement | undefined,
): AuthRequirement | undefined {
  if (!base && !extra) {
    return undefined;
  }

  const scopes = normalizeDeclaredScopes([...(base?.scopes ?? []), ...(extra?.scopes ?? [])]);
  const optional =
    extra && Object.hasOwn(extra, 'optional')
      ? extra.optional
      : base?.optional === true && extra?.strategy
        ? false
        : base?.optional;
  const strategy = extra?.strategy ?? base?.strategy;

  if (!strategy && !scopes && optional !== true) {
    return undefined;
  }

  return {
    optional,
    scopes,
    strategy,
  };
}
