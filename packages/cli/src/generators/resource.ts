import type { GenerateOptions, GeneratedFile } from '../types.js';

import { generateControllerFiles } from './controller.js';
import { generateModuleFiles } from './module.js';
import { generateRepoFiles } from './repository.js';
import { generateRequestDtoFiles } from './request-dto.js';
import { generateResponseDtoFiles } from './response-dto.js';
import { generateServiceFiles } from './service.js';

/**
 * Generate a complete feature resource slice.
 *
 * @param name The resource name.
 * @param options The generation options.
 * @returns The generated resource files.
 */
export function generateResourceFiles(name: string, options: GenerateOptions = {}): GeneratedFile[] {
  return [
    ...generateModuleFiles(name),
    ...generateRepoFiles(name, options),
    ...generateServiceFiles(name, { ...options, hasRepo: true }),
    ...generateControllerFiles(name, { ...options, hasService: true }),
    ...generateRequestDtoFiles(`Create ${name}`),
    ...generateResponseDtoFiles(name),
  ];
}
