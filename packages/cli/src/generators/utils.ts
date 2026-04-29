/**
 * To kebab case.
 *
 * @param value The value.
 * @returns The to kebab case result.
 */
export function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

/**
 * To pascal case.
 *
 * @param value The value.
 * @returns The to pascal case result.
 */
export function toPascalCase(value: string): string {
  return toKebabCase(value)
    .split('-')
    .filter(Boolean)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join('');
}

/**
 * To plural.
 *
 * @param value The value.
 * @returns The to plural result.
 */
export function toPlural(value: string): string {
  if (value.endsWith('s') || value.endsWith('x') || value.endsWith('z') || value.endsWith('ch') || value.endsWith('sh')) {
    return `${value}es`;
  }

  if (value.endsWith('y') && value.length > 1) {
    const beforeY = value[value.length - 2];
    if (!'aeiou'.includes(beforeY)) {
      return `${value.slice(0, -1)}ies`;
    }
  }

  return `${value}s`;
}
