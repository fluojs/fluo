import type { GenerateOptions, GeneratedFile } from '../types.js';

import { renderTemplate } from './render.js';
import { toKebabCase, toPascalCase } from './utils.js';

/**
 * Generate repo files.
 *
 * @param name The name.
 * @param _options The options.
 * @returns The generate repo files result.
 */
export function generateRepoFiles(name: string, _options: GenerateOptions = {}): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const pascal = `${resource}Repo`;

  return [
    {
      content: renderTemplate('repository.ts.ejs', { kebab, resource, pascal }),
      path: `${kebab}.repo.ts`,
    },
    {
      content: renderTemplate('repository.test.ts.ejs', { kebab, resource, pascal }),
      path: `${kebab}.repo.test.ts`,
    },
    {
      content: renderTemplate('repository.slice.test.ts.ejs', { kebab, resource, pascal }),
      path: `${kebab}.repo.slice.test.ts`,
    },
  ];
}
