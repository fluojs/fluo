import { describe, expect, it, vi } from 'vitest';

import { generateControllerFiles } from './generators/controller.js';
import { generateGuardFiles } from './generators/guard.js';
import { generateInterceptorFiles } from './generators/interceptor.js';
import { generateMiddlewareFiles } from './generators/middleware.js';
import { generateModuleFiles, registerInModule } from './generators/module.js';
import { generateRepoFiles } from './generators/repository.js';
import { generateRequestDtoFiles } from './generators/request-dto.js';
import { generateResponseDtoFiles } from './generators/response-dto.js';
import { renderTemplate } from './generators/render.js';
import { generateServiceFiles } from './generators/service.js';
import { GeneratorRegistry, defaultRegistry } from './registry.js';

describe('CLI generators', () => {
  it('follow naming conventions for default generators', () => {
    expect(generateModuleFiles('User')[0]?.path).toBe('user.module.ts');
    expect(generateControllerFiles('User')[0]?.path).toBe('user.controller.ts');
    expect(generateServiceFiles('User')[0]?.path).toBe('user.service.ts');
    expect(generateRepoFiles('User')[0]?.path).toBe('user.repo.ts');
    expect(generateRequestDtoFiles('User')[0]?.path).toBe('user.request.dto.ts');
    expect(generateResponseDtoFiles('User')[0]?.path).toBe('user.response.dto.ts');
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

  it('emits request DTO templates with split validator imports', () => {
    const dto = generateRequestDtoFiles('User')[0]?.content ?? '';

    expect(dto).toContain("from '@konekti/http'");
    expect(dto).toContain("from '@konekti/dto-validator'");
    expect(dto).toContain('@FromBody(\'user\')');
    expect(dto).toContain('@MinLength(1');
  });

  it('emits response DTO templates with response naming', () => {
    const dto = generateResponseDtoFiles('User')[0]?.content ?? '';

    expect(dto).toContain('export class UserResponseDto');
    expect(dto).toContain('user!: string;');
    expect(dto).not.toContain('@FromBody');
  });

  it('generates module file with empty controllers and providers arrays', () => {
    const content = generateModuleFiles('User')[0]?.content ?? '';
    expect(content).toContain('controllers: []');
    expect(content).toContain('providers: []');
  });

  it('generates guard file with correct naming', () => {
    expect(generateGuardFiles('Auth')[0]?.path).toBe('auth.guard.ts');
  });

  it('generates guard with Guard interface implementation', () => {
    const content = generateGuardFiles('Auth')[0]?.content ?? '';
    expect(content).toContain('implements Guard');
    expect(content).toContain('canActivate');
    expect(content).toContain("from '@konekti/http'");
  });

  it('generates interceptor file with correct naming', () => {
    expect(generateInterceptorFiles('Logging')[0]?.path).toBe('logging.interceptor.ts');
  });

  it('generates interceptor with Interceptor interface implementation', () => {
    const content = generateInterceptorFiles('Logging')[0]?.content ?? '';
    expect(content).toContain('implements Interceptor');
    expect(content).toContain('intercept');
    expect(content).toContain("from '@konekti/http'");
  });

  it('generates middleware file with correct naming', () => {
    expect(generateMiddlewareFiles('Auth')[0]?.path).toBe('auth.middleware.ts');
  });

  it('generates middleware with Middleware interface and static forRoutes', () => {
    const content = generateMiddlewareFiles('Auth')[0]?.content ?? '';
    expect(content).toContain('implements Middleware');
    expect(content).toContain('static forRoutes');
    expect(content).toContain('MiddlewareRouteConfig');
    expect(content).toContain("from '@konekti/http'");
  });

  it('generates middleware that registers into middleware array', () => {
    const content = generateMiddlewareFiles('Auth')[0]?.content ?? '';
    expect(content).toContain('handle(context: MiddlewareContext, next: Next)');
  });

  it('renders templates through ejs', () => {
    const rendered = renderTemplate('service.ts.ejs', {
      kebab: 'user',
      pascal: 'UserService',
      repo: 'UserRepo',
      resource: 'User',
    });

    expect(rendered).toContain("import { UserRepo } from './user.repo';");
    expect(rendered).toContain('export class UserService');
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

    it('injects middleware array when absent and registers the class', () => {
      const result = registerInModule(baseModule, 'middleware', 'AuthMiddleware');
      expect(result).toContain('AuthMiddleware');
      expect(result).toContain('middleware:');
    });

    it('registers middleware into an existing middleware array', () => {
      const withMiddlewareArray = baseModule.replace(
        '@Module({\n  controllers: [],\n  providers: [],\n})',
        '@Module({\n  controllers: [],\n  providers: [],\n  middleware: [],\n})'
      );
      const result = registerInModule(withMiddlewareArray, 'middleware', 'AuthMiddleware');
      expect(result).toMatch(/middleware:\s*\[[\s\S]*AuthMiddleware/);
    });
  });
});

describe('GeneratorRegistry', () => {
  it('resolves all built-in generator kinds from defaultRegistry', () => {
    const kinds = ['controller', 'guard', 'interceptor', 'middleware', 'module', 'repository', 'repo', 'request-dto', 'response-dto', 'service'] as const;
    for (const kind of kinds) {
      expect(defaultRegistry.has(kind), `expected defaultRegistry to have kind: ${kind}`).toBe(true);
    }
  });

  it('returns undefined for unknown kind', () => {
    expect(defaultRegistry.resolve('unknown')).toBeUndefined();
  });

  it('allows registering and invoking custom generators', () => {
    const registry = new GeneratorRegistry();
    const factory = vi.fn().mockReturnValue([{ path: 'foo.ts', content: 'bar' }]);
    registry.register('custom', factory);
    expect(registry.has('custom')).toBe(true);
    const result = registry.resolve('custom')?.('Foo');
    expect(factory).toHaveBeenCalledWith('Foo');
    expect(result).toEqual([{ path: 'foo.ts', content: 'bar' }]);
  });

  it('overrides an existing registration', () => {
    const registry = new GeneratorRegistry();
    const original = vi.fn().mockReturnValue([]);
    const replacement = vi.fn().mockReturnValue([{ path: 'replaced.ts', content: '' }]);
    registry.register('controller', original);
    registry.register('controller', replacement);
    registry.resolve('controller')?.('User');
    expect(replacement).toHaveBeenCalledOnce();
    expect(original).not.toHaveBeenCalled();
  });

  it('lists all registered kinds', () => {
    const registry = new GeneratorRegistry();
    registry.register('a', vi.fn()).register('b', vi.fn());
    expect(registry.kinds()).toEqual(['a', 'b']);
  });
});
