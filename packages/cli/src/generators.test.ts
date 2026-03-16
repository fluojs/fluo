import { describe, expect, it } from 'vitest';

import { generateControllerFiles } from './generators/controller.js';
import { generateDtoFiles } from './generators/dto.js';
import { generateModuleFiles, registerInModule } from './generators/module.js';
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

  it('emits generic repository examples without ORM-specific access', () => {
    const content = generateRepoFiles('User')[0]?.content ?? '';

    expect(content).toContain('return [];');
    expect(content).not.toContain('this.prisma.current()');
    expect(content).not.toContain('this.database.current()');
  });

  it('emits DTO templates with split validator imports', () => {
    const dto = generateDtoFiles('User')[0]?.content ?? '';

    expect(dto).toContain("from '@konekti/http'");
    expect(dto).toContain("from '@konekti/dto-validator'");
    expect(dto).toContain('@FromBody(\'user\')');
    expect(dto).toContain('@MinLength(1');
  });

  it('generates module file with empty controllers and providers arrays', () => {
    const content = generateModuleFiles('User')[0]?.content ?? '';
    expect(content).toContain('controllers: []');
    expect(content).toContain('providers: []');
  });

  describe('registerInModule', () => {
    const baseModule = `import { Module } from '@konekti/core';\n\n@Module({\n  controllers: [],\n  providers: [],\n})\nclass UserModule {}\n\nexport { UserModule };\n`;

    it('inserts a provider into an empty providers array', () => {
      const result = registerInModule(baseModule, 'providers', 'UserService');
      expect(result).toContain('UserService');
      expect(result).toMatch(/providers:\s*\[[\s\S]*UserService/);
    });

    it('inserts a controller into an empty controllers array', () => {
      const result = registerInModule(baseModule, 'controllers', 'UserController');
      expect(result).toContain('UserController');
      expect(result).toMatch(/controllers:\s*\[[\s\S]*UserController/);
    });

    it('does not duplicate an already-present class', () => {
      const withService = registerInModule(baseModule, 'providers', 'UserService');
      const again = registerInModule(withService, 'providers', 'UserService');
      const occurrences = (again.match(/UserService/g) ?? []).length;
      expect(occurrences).toBe(1);
    });

    it('appends to a non-empty array without removing existing entries', () => {
      const withService = registerInModule(baseModule, 'providers', 'UserService');
      const withRepo = registerInModule(withService, 'providers', 'UserRepo');
      expect(withRepo).toContain('UserService');
      expect(withRepo).toContain('UserRepo');
    });
  });
});
