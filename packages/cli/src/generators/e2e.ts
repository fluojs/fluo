import type { GenerateOptions, GeneratedFile } from '../types.js';

import { renderTemplate } from './render.js';
import { toKebabCase } from './utils.js';

/**
 * Generate an app-level e2e-style test file.
 *
 * @param name The e2e test name.
 * @param options The generation options.
 * @returns The generated e2e test files.
 */
export function generateE2eFiles(name: string, options: GenerateOptions = {}): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const rootModuleImport = options.e2eRootModuleImport ?? '../src/app';

  return [
    {
      content: renderTemplate('e2e.test.ts.ejs', { kebab, rootModuleImport }),
      path: `${kebab}.e2e.test.ts`,
    },
  ];
}
