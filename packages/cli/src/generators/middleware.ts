import type { GeneratedFile } from '../types.js';

import { toKebabCase, toPascalCase } from './utils.js';

export function generateMiddlewareFiles(name: string): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const pascal = `${resource}Middleware`;

  return [{
    content: `import type { Middleware, MiddlewareContext, MiddlewareRouteConfig, Next } from '@konekti/http';

export class ${pascal} implements Middleware {
  static forRoutes(...routes: string[]): MiddlewareRouteConfig {
    return { middleware: ${pascal}, routes };
  }

  async handle(context: MiddlewareContext, next: Next): Promise<void> {
    await next();
  }
}
`,
    path: `${kebab}.middleware.ts`,
  }];
}
