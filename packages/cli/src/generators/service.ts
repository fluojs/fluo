import type { GenerateOptions, GeneratedFile } from '../types';

import { toKebabCase, toPascalCase } from './utils';

export function generateServiceFiles(name: string, _options: GenerateOptions = {}): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const pascal = `${resource}Service`;
  const repo = `${resource}Repo`;

  return [
    {
      content: `import { Inject } from '@konekti/core';

import { ${repo} } from './${kebab}.repo';

@Inject([${repo}])
export class ${pascal} {
  constructor(private readonly repo: ${repo}) {}

  async list${resource}s() {
    return this.repo.list${resource}s();
  }
}
`,
      path: `${kebab}.service.ts`,
    },
    {
      content: `import { describe, expect, it } from 'vitest';

import { ${pascal} } from './${kebab}.service';

class Fake${repo} {
  list${resource}s() {
    return [{ id: '${kebab}-1' }];
  }
}

describe('${pascal}', () => {
  it('delegates to the repo', async () => {
    await expect(new ${pascal}(new Fake${repo}() as never).list${resource}s()).resolves.toEqual([{ id: '${kebab}-1' }]);
  });
});
`,
      path: `${kebab}.service.test.ts`,
    },
  ];
}
