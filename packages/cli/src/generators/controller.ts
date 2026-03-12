import type { GeneratedFile } from '../types';

import { toKebabCase, toPascalCase } from './utils';

export function generateControllerFiles(name: string): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const pascal = `${resource}Controller`;
  const service = `${resource}Service`;

  return [
    {
      content: `import { Inject } from '@konekti/core';
import { Controller, Get } from '@konekti/http';

import { ${service} } from './${kebab}.service';

@Controller('/${kebab}')
@Inject([${service}])
class ${pascal} {
  constructor(private readonly service: ${service}) {}

  @Get('/')
  async list${resource}s() {
    return this.service.list${resource}s();
  }
}

export { ${pascal} };
`,
      path: `${kebab}.controller.ts`,
    },
    {
      content: `import { describe, expect, it } from 'vitest';

import { ${pascal} } from './${kebab}.controller';

class Fake${service} {
  async list${resource}s() {
    return [{ id: '${kebab}-1' }];
  }
}

describe('${pascal}', () => {
  it('delegates to the service', async () => {
    await expect(new ${pascal}(new Fake${service}() as never).list${resource}s()).resolves.toEqual([{ id: '${kebab}-1' }]);
  });
});
`,
      path: `${kebab}.controller.test.ts`,
    },
  ];
}
