import type { GeneratedFile } from '../types.js';

import { toKebabCase, toPascalCase } from './utils.js';

export function generateGuardFiles(name: string): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const pascal = `${resource}Guard`;

  return [{
    content: `import type { Guard, GuardContext } from '@konekti/http';

export class ${pascal} implements Guard {
  canActivate(context: GuardContext): boolean {
    return true;
  }
}
`,
    path: `${kebab}.guard.ts`,
  }];
}
