import type { GenerateOptions, GeneratedFile } from '../types.js';

import { generateControllerFiles } from './controller.js';
import { generateRepoFiles } from './repository.js';
import { generateRequestDtoFiles } from './request-dto.js';
import { generateResponseDtoFiles } from './response-dto.js';
import { renderTemplate } from './render.js';
import { generateServiceFiles } from './service.js';
import { toKebabCase, toPascalCase } from './utils.js';

/**
 * Generate a complete feature resource slice.
 *
 * @param name The resource name.
 * @param options The generation options.
 * @returns The generated resource files.
 */
export function generateResourceFiles(name: string, options: GenerateOptions = {}): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const module = `${resource}Module`;
  const controller = `${resource}Controller`;
  const repo = `${resource}Repo`;
  const service = `${resource}Service`;
  const files: GeneratedFile[] = [
    {
      content: renderTemplate('resource.module.ts.ejs', { controller, kebab, module, repo, service }),
      path: `${kebab}.module.ts`,
    },
    ...generateRepoFiles(name, options),
    ...generateServiceFiles(name, { ...options, hasRepo: true }),
    ...generateControllerFiles(name, { ...options, hasService: true }),
    ...generateRequestDtoFiles(`Create ${name}`),
    ...generateResponseDtoFiles(name),
  ];

  if (options.withSliceTest) {
    files.push({
      content: renderTemplate('resource.slice.test.ts.ejs', { kebab, repo, resource, service }),
      path: `${kebab}.slice.test.ts`,
    });
  }

  return files;
}
