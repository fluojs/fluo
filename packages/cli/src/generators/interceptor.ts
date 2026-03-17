import type { GeneratedFile } from '../types.js';

import { toKebabCase, toPascalCase } from './utils.js';

export function generateInterceptorFiles(name: string): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const pascal = `${resource}Interceptor`;

  return [{
    content: `import type { CallHandler, Interceptor, InterceptorContext } from '@konekti/http';

export class ${pascal} implements Interceptor {
  async intercept(context: InterceptorContext, next: CallHandler): Promise<unknown> {
    return next.handle();
  }
}
`,
    path: `${kebab}.interceptor.ts`,
  }];
}
