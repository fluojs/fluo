import type { GeneratedFile } from '../types.js';

import { renderTemplate } from './render.js';
import { toKebabCase, toPascalCase } from './utils.js';

export function generateGuardFiles(name: string): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const pascal = `${resource}Guard`;

  return [{
    content: renderTemplate('guard.ts.ejs', { kebab, resource, pascal }),
    path: `${kebab}.guard.ts`,
  }];
}
