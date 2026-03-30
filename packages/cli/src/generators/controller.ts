import type { GenerateOptions, GeneratedFile } from '../types.js';

import { renderTemplate } from './render.js';
import { toKebabCase, toPascalCase } from './utils.js';

export function generateControllerFiles(name: string, options: GenerateOptions = {}): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const pascal = `${resource}Controller`;
  const service = `${resource}Service`;

  const vars = { hasService: options.hasService ?? false, kebab, resource, pascal, service };

  return [
    {
      content: renderTemplate('controller.ts.ejs', vars),
      path: `${kebab}.controller.ts`,
    },
    {
      content: renderTemplate('controller.test.ts.ejs', vars),
      path: `${kebab}.controller.test.ts`,
    },
  ];
}
