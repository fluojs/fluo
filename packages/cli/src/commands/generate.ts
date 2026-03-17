import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';

import type { GenerateOptions, GeneratedFile, GeneratorKind } from '../types.js';

import { generateControllerFiles } from '../generators/controller.js';
import { generateGuardFiles } from '../generators/guard.js';
import { generateInterceptorFiles } from '../generators/interceptor.js';
import { generateMiddlewareFiles } from '../generators/middleware.js';
import { generateModuleFiles, registerInModule } from '../generators/module.js';
import { generateRepoFiles } from '../generators/repo.js';
import { generateRequestDtoFiles } from '../generators/request-dto.js';
import { generateResponseDtoFiles } from '../generators/response-dto.js';
import { generateServiceFiles } from '../generators/service.js';
import { toKebabCase, toPascalCase, toPlural } from '../generators/utils.js';

function generateFiles(kind: GeneratorKind, name: string, options: GenerateOptions = {}): GeneratedFile[] {
  switch (kind) {
    case 'controller':
      return generateControllerFiles(name);
    case 'guard':
      return generateGuardFiles(name);
    case 'interceptor':
      return generateInterceptorFiles(name);
    case 'middleware':
      return generateMiddlewareFiles(name);
    case 'module':
      return generateModuleFiles(name);
    case 'repo':
      return generateRepoFiles(name, options);
    case 'request-dto':
      return generateRequestDtoFiles(name);
    case 'response-dto':
      return generateResponseDtoFiles(name);
    case 'service':
      return generateServiceFiles(name, options);
    default:
      return [];
  }
}

function moduleArrayKey(kind: GeneratorKind): 'controllers' | 'providers' | 'middleware' | null {
  if (kind === 'controller') return 'controllers';
  if (kind === 'service' || kind === 'repo' || kind === 'guard' || kind === 'interceptor') return 'providers';
  if (kind === 'middleware') return 'middleware';
  return null;
}

function classNameForKind(name: string, kind: GeneratorKind): string {
  const resource = toPascalCase(name);
  if (kind === 'controller') return `${resource}Controller`;
  if (kind === 'service') return `${resource}Service`;
  if (kind === 'repo') return `${resource}Repo`;
  if (kind === 'guard') return `${resource}Guard`;
  if (kind === 'interceptor') return `${resource}Interceptor`;
  if (kind === 'middleware') return `${resource}Middleware`;
  return resource;
}

function ensureModuleFile(domainDirectory: string, name: string): string {
  const kebab = toKebabCase(name);
  const modulePath = join(domainDirectory, `${kebab}.module.ts`);

  if (!existsSync(modulePath)) {
    const [moduleFile] = generateModuleFiles(name);
    if (moduleFile) {
      mkdirSync(domainDirectory, { recursive: true });
      writeFileSync(modulePath, moduleFile.content, 'utf8');
    }
  }

  return modulePath;
}

function updateModuleFile(modulePath: string, arrayKey: 'controllers' | 'providers' | 'middleware', className: string, importPath: string): void {
  let source = readFileSync(modulePath, 'utf8');

  const alreadyImported = /^import [^;]*;$/m.test(source) &&
    new RegExp(`^import[^;]*\\b${className}\\b[^;]*;`, 'm').test(source);

  if (!alreadyImported) {
    const lastImportMatch = [...source.matchAll(/^import .+;$/gm)].at(-1);
    const importLine = `import { ${className} } from './${importPath}';\n`;
    if (lastImportMatch?.index !== undefined) {
      const insertAt = lastImportMatch.index + lastImportMatch[0].length;
      source = source.slice(0, insertAt) + '\n' + importLine + source.slice(insertAt);
    } else {
      source = importLine + source;
    }
  }

  source = registerInModule(source, arrayKey, className);
  writeFileSync(modulePath, source, 'utf8');
}

export function runGenerateCommand(kind: GeneratorKind, name: string, baseDirectory: string, options: GenerateOptions = {}): string[] {
  const kebab = toKebabCase(name);

  if (kebab !== normalize(kebab) || kebab.includes('/') || kebab.includes('\\') || kebab.includes('..')) {
    throw new Error(`Invalid resource name "${name}": must not contain path separators or traversal sequences.`);
  }

  const resolvedBase = resolve(baseDirectory);
  const domainDirectory = join(resolvedBase, toPlural(kebab));

  mkdirSync(domainDirectory, { recursive: true });

  const files = generateFiles(kind, name, options);

  const writtenPaths = files.map((file) => {
    const filePath = join(domainDirectory, file.path);

    if (!options.force && existsSync(filePath)) {
      return null;
    }

    writeFileSync(filePath, file.content, 'utf8');
    return filePath;
  }).filter((filePath): filePath is string => filePath !== null);

  const arrayKey = moduleArrayKey(kind);
  if (arrayKey !== null) {
    const modulePath = ensureModuleFile(domainDirectory, name);
    const className = classNameForKind(name, kind);
    const importPath = `${kebab}.${kind}`;
    updateModuleFile(modulePath, arrayKey, className, importPath);

    if (!writtenPaths.includes(modulePath)) {
      writtenPaths.push(modulePath);
    }
  }

  return writtenPaths;
}
