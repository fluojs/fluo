import type { GenerateOptions, GeneratedFile } from '../types.js';

import { toKebabCase, toPascalCase } from './utils.js';

function createRepoImplementation(resource: string): string {
  return `
type ${resource}Record = {
  id: string;
};

export class ${resource}Repo {
  async list${resource}s(): Promise<${resource}Record[]> {
    return [];
  }
}
`;
}

export function generateRepoFiles(name: string, _options: GenerateOptions = {}): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const pascal = `${resource}Repo`;

  return [
    {
      content: createRepoImplementation(resource),
      path: `${kebab}.repo.ts`,
    },
    {
      content: `import { describe, expect, it } from 'vitest';

import { ${pascal} } from './${kebab}.repo';

describe('${pascal}', () => {
  it('exposes a list method', () => {
    expect(typeof ${pascal}.prototype.list${resource}s).toBe('function');
  });
});
`,
      path: `${kebab}.repo.test.ts`,
    },
  ];
}
