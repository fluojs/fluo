/**
 * Expands parsed env values against the explicit process snapshot.
 *
 * @internal
 * @param parsed Values produced by the built-in dotenv parser.
 * @param safeProcessEnv Sanitized process snapshot with higher lookup precedence.
 * @returns Expanded env-file values without mutating the input dictionaries.
 */
export function expandEnvVariables(parsed: Record<string, string>, safeProcessEnv: Record<string, string>): Record<string, string> {
  const expanded: Record<string, string> = {};
  const source = { ...parsed, ...safeProcessEnv };

  const parseBracedExpansion = (expression: string): { defaultOperator?: string; defaultValue?: string; variableName: string } => {
    if (expression in source) {
      return { variableName: expression };
    }

    const colonDefaultIndex = expression.indexOf(':-');
    if (colonDefaultIndex !== -1) {
      return {
        defaultOperator: ':-',
        defaultValue: expression.slice(colonDefaultIndex + 2),
        variableName: expression.slice(0, colonDefaultIndex),
      };
    }

    const defaultIndex = expression.indexOf('-');
    if (defaultIndex !== -1) {
      return {
        defaultOperator: '-',
        defaultValue: expression.slice(defaultIndex + 1),
        variableName: expression.slice(0, defaultIndex),
      };
    }

    return { variableName: expression };
  };

  const expandValue = (value: string, visiting: ReadonlySet<string>): string =>
    value.replace(/(^|[^\\])\$(?:\{([^}]*)\}|([\w.-]+))/g, (match: string, prefix: string, bracedExpression: string | undefined, bareVariableName: string | undefined) => {
      const expansion = bracedExpression === undefined
        ? { variableName: bareVariableName ?? '' }
        : parseBracedExpansion(bracedExpression);
      const { defaultOperator, defaultValue, variableName } = expansion;

      if (!variableName) {
        return match;
      }

      const hasSourceValue = variableName in source;
      const sourceValue = hasSourceValue ? source[variableName] ?? '' : undefined;
      const shouldUseDefaultValue = defaultValue !== undefined && (!hasSourceValue || (defaultOperator === ':-' && sourceValue === ''));

      if (shouldUseDefaultValue) {
        return `${prefix}${expandValue(defaultValue, visiting)}`;
      }

      if (!hasSourceValue || visiting.has(variableName)) {
        return prefix;
      }

      const replacement = variableName in safeProcessEnv
        ? safeProcessEnv[variableName]
        : variableName in expanded
          ? expanded[variableName]
          : expandValue(sourceValue ?? '', new Set([...visiting, variableName]));

      return `${prefix}${replacement}`;
    }).replace(/\\\$/g, '$');

  for (const [key, value] of Object.entries(parsed)) {
    expanded[key] = expandValue(value, new Set([key]));
    source[key] = expanded[key];
  }

  return expanded;
}
