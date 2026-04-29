import type { GeneratedFile } from '../types.js';

import { renderTemplate } from './render.js';
import { toKebabCase, toPascalCase } from './utils.js';

/**
 * Generate middleware files.
 *
 * @param name The name.
 * @returns The generate middleware files result.
 */
export function generateMiddlewareFiles(name: string): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const pascal = `${resource}Middleware`;

  return [{
    content: renderTemplate('middleware.ts.ejs', { kebab, resource, pascal }),
    path: `${kebab}.middleware.ts`,
  }];
}
