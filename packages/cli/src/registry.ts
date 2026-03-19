import type { GenerateOptions, GeneratedFile, GeneratorFactory, GeneratorRegistration } from './types.js';

import { generateControllerFiles } from './generators/controller.js';
import { generateGuardFiles } from './generators/guard.js';
import { generateInterceptorFiles } from './generators/interceptor.js';
import { generateMiddlewareFiles } from './generators/middleware.js';
import { generateModuleFiles } from './generators/module.js';
import { generateRepoFiles } from './generators/repository.js';
import { generateRequestDtoFiles } from './generators/request-dto.js';
import { generateResponseDtoFiles } from './generators/response-dto.js';
import { generateServiceFiles } from './generators/service.js';

export class GeneratorRegistry {
  private readonly registry = new Map<string, GeneratorRegistration>();

  register(kind: string, factory: GeneratorFactory, description?: string): this {
    this.registry.set(kind, { factory, description });
    return this;
  }

  resolve(kind: string): GeneratorFactory | undefined {
    return this.registry.get(kind)?.factory;
  }

  has(kind: string): boolean {
    return this.registry.has(kind);
  }

  kinds(): string[] {
    return Array.from(this.registry.keys());
  }
}

export const defaultRegistry = new GeneratorRegistry()
  .register('controller', (name) => generateControllerFiles(name))
  .register('guard', (name) => generateGuardFiles(name))
  .register('interceptor', (name) => generateInterceptorFiles(name))
  .register('middleware', (name) => generateMiddlewareFiles(name))
  .register('module', (name) => generateModuleFiles(name))
  .register('repo', (name, options?: GenerateOptions) => generateRepoFiles(name, options))
  .register('repository', (name, options?: GenerateOptions) => generateRepoFiles(name, options))
  .register('request-dto', (name) => generateRequestDtoFiles(name))
  .register('response-dto', (name) => generateResponseDtoFiles(name))
  .register('service', (name, options?: GenerateOptions) => generateServiceFiles(name, options));

