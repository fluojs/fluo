import type { GenerateOptions, GeneratedFile, GeneratorPreset } from '../types';

import { toKebabCase, toPascalCase } from './utils';

function createRepoImplementation(resource: string, preset: GeneratorPreset): string {
  if (preset === 'prisma') {
    return `import { Inject } from '@konekti/core';
import type { PrismaClientLike } from '@konekti/prisma';
import { PrismaService } from '@konekti/prisma';

type ${resource}Record = {
  id: string;
};

type ${resource}PrismaClient = PrismaClientLike<{
  ${resource.toLowerCase()}: {
    findMany(): Promise<${resource}Record[]>;
  };
}> & {
  ${resource.toLowerCase()}: {
    findMany(): Promise<${resource}Record[]>;
  };
};

@Inject([PrismaService])
export class ${resource}Repo {
  constructor(private readonly prisma: PrismaService<${resource}PrismaClient>) {}

  async list${resource}s(): Promise<${resource}Record[]> {
    const current = this.prisma.current();

    return current.${resource.toLowerCase()}.findMany();
  }
}
`;
  }

  if (preset === 'drizzle') {
    return `import { Inject } from '@konekti/core';
import { DrizzleDatabase } from '@konekti/drizzle';

type ${resource}Record = {
  id: string;
};

@Inject([DrizzleDatabase])
export class ${resource}Repo {
  constructor(
    private readonly database: DrizzleDatabase<{
      ${resource.toLowerCase()}s: {
        findMany(): Promise<${resource}Record[]>;
      };
    }>,
  ) {}

  async list${resource}s(): Promise<${resource}Record[]> {
    const current = this.database.current();

    return current.${resource.toLowerCase()}s.findMany();
  }
}
`;
  }

  return `export class ${resource}Repo {
  list${resource}s() {
    return [{ id: '${toKebabCase(resource)}-1' }];
  }
}
`;
}

export function generateRepoFiles(name: string, options: GenerateOptions = {}): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const pascal = `${resource}Repo`;
  const preset = options.preset ?? 'generic';

  return [
    {
      content: createRepoImplementation(resource, preset),
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
