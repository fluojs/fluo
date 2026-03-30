import type { GenerateOptions, GeneratedFile } from '../types.js';

import { renderTemplate } from './render.js';
import { toKebabCase, toPascalCase } from './utils.js';

export function generateServiceFiles(name: string, _options: GenerateOptions = {}): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const pascal = `${resource}Service`;
  const repo = `${resource}Repo`;

  const vars = { hasRepo: _options.hasRepo ?? false, kebab, resource, pascal, repo };

  return [
    {
      content: renderTemplate('service.ts.ejs', vars),
      path: `${kebab}.service.ts`,
    },
    {
      content: renderTemplate('service.test.ts.ejs', vars),
      path: `${kebab}.service.test.ts`,
    },
  ];
}
