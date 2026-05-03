import { describe, expect, it, vi } from 'vitest';

import { generateControllerFiles } from './generators/controller.js';
import { generateGuardFiles } from './generators/guard.js';
import { generateInterceptorFiles } from './generators/interceptor.js';
import {
  builtInGeneratorCollection,
  generatorCollections,
  generatorManifest,
  generatorOptionSchemas,
  listGeneratorCollections,
  listGeneratorDefinitions,
} from './generators/manifest.js';
import { generateMiddlewareFiles } from './generators/middleware.js';
import { ensureModuleImport, generateModuleFiles, registerInModule } from './generators/module.js';
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
    expect(generateRepoFiles('User')[2]?.path).toBe('user.repo.slice.test.ts');
  });

  it('emits repo slice templates based on stable testing APIs', () => {
    const content = generateRepoFiles('User')[2]?.content ?? '';

    expect(content).toContain("from '@fluojs/testing'");
    expect(content).toContain('createTestingModule({ rootModule: UserModule })');
    expect(content).toContain('await testingModule.resolve(UserRepo)');
  });

  it('emits generic repository examples without ORM-specific access', () => {
    const content = generateRepoFiles('User')[0]?.content ?? '';

    expect(content).toContain('return [];');
    expect(content).not.toContain('this.prisma.current()');
    expect(content).not.toContain('this.database.current()');
  });

  it('emits request DTO templates with split validator imports', () => {
    const dto = generateRequestDtoFiles('User')[0]?.content ?? '';

    expect(dto).toContain("from '@fluojs/http'");
    expect(dto).toContain("from '@fluojs/validation'");
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
    expect(content).toContain("from '@fluojs/http'");
  });

  it('generates interceptor file with correct naming', () => {
    expect(generateInterceptorFiles('Logging')[0]?.path).toBe('logging.interceptor.ts');
  });

  it('generates interceptor with Interceptor interface implementation', () => {
    const content = generateInterceptorFiles('Logging')[0]?.content ?? '';
    expect(content).toContain('implements Interceptor');
    expect(content).toContain('intercept');
    expect(content).toContain("from '@fluojs/http'");
  });

  it('generates middleware file with correct naming', () => {
    expect(generateMiddlewareFiles('Auth')[0]?.path).toBe('auth.middleware.ts');
  });

  it('generates middleware with Middleware interface and static forRoutes', () => {
    const content = generateMiddlewareFiles('Auth')[0]?.content ?? '';
    expect(content).toContain('implements Middleware');
    expect(content).toContain('static forRoutes');
    expect(content).toContain('MiddlewareRouteConfig');
    expect(content).toContain("from '@fluojs/http'");
  });

  it('generates middleware that registers into middleware array', () => {
    const content = generateMiddlewareFiles('Auth')[0]?.content ?? '';
    expect(content).toContain('handle(context: MiddlewareContext, next: Next)');
  });

  it('renders templates through ejs', () => {
    const rendered = renderTemplate('service.ts.ejs', {
      hasRepo: true,
      kebab: 'user',
      pascal: 'UserService',
      repo: 'UserRepo',
      resource: 'User',
    });

    expect(rendered).toContain("import { UserRepo } from './user.repo';");
    expect(rendered).toContain('export class UserService');
  });

  it('renders standalone controller and service templates without missing sibling imports', () => {
    const controller = generateControllerFiles('User')[0]?.content ?? '';
    const service = generateServiceFiles('User')[0]?.content ?? '';

    expect(controller).not.toContain("from './user.service'");
    expect(controller).not.toContain("from '@fluojs/core'");
    expect(controller).toContain('return [];');
    expect(service).not.toContain("from './user.repo'");
    expect(service).not.toContain("from '@fluojs/core'");
    expect(service).toContain('return [];');
  });

  it('renders controller and service templates with sibling imports when requested', () => {
    const controller = generateControllerFiles('User', { hasService: true })[0]?.content ?? '';
    const service = generateServiceFiles('User', { hasRepo: true })[0]?.content ?? '';

    expect(controller).toContain("import { UserService } from './user.service';");
    expect(controller).toContain('@Inject(UserService)');
    expect(service).toContain("import { UserRepo } from './user.repo';");
    expect(service).toContain('@Inject(UserRepo)');
  });

  describe('registerInModule', () => {
    const baseModule = `import { Module } from '@fluojs/core';\n\n@Module({\n  controllers: [],\n  providers: [],\n})\nclass UserModule {}\n\nexport { UserModule };\n`;

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

    it('throws when target metadata property is not an array', () => {
      const malformedModule = baseModule.replace('providers: []', 'providers: UserService');
      expect(() => registerInModule(malformedModule, 'providers', 'UserRepo')).toThrow('"providers" must be an array');
    });
  });

  describe('ensureModuleImport', () => {
    it('inserts a new import after the last import declaration', () => {
      const source = `import { Module } from '@fluojs/core';\n\n@Module({\n  controllers: [],\n  providers: [],\n})\nclass UserModule {}\n`;
      const result = ensureModuleImport(source, 'UserService', 'user.service');

      expect(result).toContain('import { UserService } from "./user.service";');
      expect(result.indexOf('import { UserService } from "./user.service";')).toBeGreaterThan(result.indexOf("import { Module } from '@fluojs/core';"));
      expect(result.indexOf('@Module({')).toBeGreaterThan(result.indexOf('import { UserService } from "./user.service";'));
    });

    it('appends a class to an existing import from the same module path', () => {
      const source = `import { ExistingService } from './user.service';\n\n@Module({\n  controllers: [],\n  providers: [],\n})\nclass UserModule {}\n`;
      const result = ensureModuleImport(source, 'UserRepo', 'user.service');

      expect(result).toContain('import { ExistingService, UserRepo } from');
      expect(result).toContain('./user.service');
    });

    it('does not duplicate an existing named import', () => {
      const source = `import { UserService } from './user.service';\n\n@Module({\n  controllers: [],\n  providers: [],\n})\nclass UserModule {}\n`;
      const result = ensureModuleImport(source, 'UserService', 'user.service');
      const occurrences = (result.match(/UserService/g) ?? []).length;

      expect(occurrences).toBe(1);
    });

    it('throws when the same class is already imported from a different module path', () => {
      const source = `import { UserService } from './legacy.service';\n\n@Module({\n  controllers: [],\n  providers: [],\n})\nclass UserModule {}\n`;

      expect(() => ensureModuleImport(source, 'UserService', 'user.service')).toThrow(
        'Import collision for UserService: already imported from "./legacy.service" but requested from "./user.service".',
      );
    });
  });
});

describe('GeneratorRegistry', () => {
  it('exposes a single deterministic built-in collection and defers external loading', () => {
    expect(generatorCollections).toEqual([builtInGeneratorCollection]);
    expect(listGeneratorCollections()).toEqual([builtInGeneratorCollection]);
    expect(builtInGeneratorCollection).toMatchObject({
      id: '@fluojs/cli/builtin',
      source: 'built-in',
    });
    expect(listGeneratorDefinitions()).toEqual(generatorManifest);
    expect(generatorManifest.map((entry) => entry.kind)).toEqual([
      'controller',
      'guard',
      'interceptor',
      'middleware',
      'module',
      'repo',
      'request-dto',
      'resource',
      'response-dto',
      'service',
    ]);
    expect(() => listGeneratorDefinitions('@app/local')).toThrow('Unknown generator collection: @app/local');
  });

  it('keeps generator option schemas explicit for help and docs alignment', () => {
    expect(generatorOptionSchemas).toEqual([
      { aliases: ['-o'], description: 'Write generated files under a specific source directory.', name: '--target-directory <path>', value: 'path' },
      { aliases: ['-f'], description: 'Overwrite files that already exist.', name: '--force', value: 'boolean' },
      { aliases: [], description: 'Preview planned writes, skips, and module wiring without touching files.', name: '--dry-run', value: 'boolean' },
      { aliases: ['-h'], description: 'Show help for the generate command.', name: '--help', value: 'boolean' },
    ]);
  });

  it('resolves all built-in generator kinds from defaultRegistry', () => {
    for (const entry of generatorManifest) {
      expect(defaultRegistry.has(entry.kind), `expected defaultRegistry to have kind: ${entry.kind}`).toBe(true);
      expect(defaultRegistry.collectionId(entry.kind)).toBe(builtInGeneratorCollection.id);

      const aliases = 'registryAliases' in entry ? entry.registryAliases : undefined;
      if (aliases) {
        for (const alias of aliases) {
          expect(defaultRegistry.has(alias), `expected defaultRegistry to have alias: ${alias}`).toBe(true);
          expect(defaultRegistry.collectionId(alias)).toBe(builtInGeneratorCollection.id);
        }
      }
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
