import type { GeneratedFile } from '../types.js';

import { renderTemplate } from './render.js';
import { toKebabCase, toPascalCase } from './utils.js';

/**
 * Generate interceptor files.
 *
 * @param name The name.
 * @returns The generate interceptor files result.
 */
export function generateInterceptorFiles(name: string): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const pascal = `${resource}Interceptor`;

  return [{
    content: renderTemplate('interceptor.ts.ejs', { kebab, resource, pascal }),
    path: `${kebab}.interceptor.ts`,
  }];
}
