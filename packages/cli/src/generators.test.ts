import { describe, expect, it } from 'vitest';

import { generateControllerFiles } from './generators/controller.js';
import { generateDtoFiles } from './generators/dto.js';
import { generateModuleFiles } from './generators/module.js';
import { generateRepoFiles } from './generators/repo.js';
import { generateServiceFiles } from './generators/service.js';

describe('CLI generators', () => {
  it('follow naming conventions for default generators', () => {
    expect(generateModuleFiles('User')[0]?.path).toBe('user.module.ts');
    expect(generateControllerFiles('User')[0]?.path).toBe('user.controller.ts');
    expect(generateServiceFiles('User')[0]?.path).toBe('user.service.ts');
    expect(generateRepoFiles('User')[0]?.path).toBe('user.repo.ts');
    expect(generateDtoFiles('User')[0]?.path).toBe('user.dto.ts');
  });

  it('emits test templates for controller, service, and repo generators', () => {
    expect(generateControllerFiles('User')[1]?.path).toBe('user.controller.test.ts');
    expect(generateServiceFiles('User')[1]?.path).toBe('user.service.test.ts');
    expect(generateRepoFiles('User')[1]?.path).toBe('user.repo.test.ts');
  });

  it('can emit preset-aware repository examples', () => {
    expect(generateRepoFiles('User', { preset: 'prisma' })[0]?.content).toContain('this.prisma.current()');
    expect(generateRepoFiles('User', { preset: 'drizzle' })[0]?.content).toContain('this.database.current()');
  });

  it('emits DTO templates with split validator imports', () => {
    const dto = generateDtoFiles('User')[0]?.content ?? '';

    expect(dto).toContain("from '@konekti/http'");
    expect(dto).toContain("from '@konekti/dto-validator'");
    expect(dto).toContain('@FromBody(\'user\')');
    expect(dto).toContain('@MinLength(1');
  });
});
