import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';

import type { GenerateOptions, GeneratorKind } from '../types.js';
import type { ModuleArrayKey } from '../generators/manifest.js';
import { findGeneratorDefinition } from '../generators/manifest.js';

import { ensureModuleImport, generateModuleFiles, registerInModule } from '../generators/module.js';
import { toKebabCase, toPascalCase, toPlural } from '../generators/utils.js';

function assertValidResourceName(name: string): string {
  const kebab = toKebabCase(name);

  if (name.trim().length === 0) {
    throw new Error('Invalid resource name: name must not be empty.');
  }

  if (kebab !== normalize(kebab) || kebab.includes('/') || kebab.includes('\\') || kebab.includes('..')) {
    throw new Error(`Invalid resource name "${name}": must not contain path separators or traversal sequences.`);
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(kebab)) {
    throw new Error(`Invalid resource name "${name}": use letters, numbers, spaces, underscores, or hyphens only.`);
  }

  return kebab;
}

function resolveModulePath(domainDirectory: string, name: string): string {
  const kebab = toKebabCase(name);
  return join(domainDirectory, `${kebab}.module.ts`);
}

function readOrCreateModuleSource(modulePath: string, name: string): string {
  if (existsSync(modulePath)) {
    return readFileSync(modulePath, 'utf8');
  }

  const [moduleFile] = generateModuleFiles(name);
  if (!moduleFile) {
    throw new Error(`Unable to generate module file for resource "${name}".`);
  }

  return moduleFile.content;
}

function buildUpdatedModuleSource(moduleSource: string, arrayKey: ModuleArrayKey, className: string, importPath: string): string {
  let source = moduleSource;
  source = ensureModuleImport(source, className, importPath);
  source = registerInModule(source, arrayKey, className);
  return source;
}

type ModuleUpdatePlan = {
  modulePath: string;
  source: string;
};

function prepareModuleUpdate(
  domainDirectory: string,
  normalizedName: string,
  kind: GeneratorKind,
  classSuffix: string,
  arrayKey: ModuleArrayKey,
): ModuleUpdatePlan {
  const kebab = toKebabCase(normalizedName);
  const modulePath = resolveModulePath(domainDirectory, normalizedName);
  const className = `${toPascalCase(normalizedName)}${classSuffix}`;
  const importPath = `${kebab}.${kind}`;
  const moduleSource = readOrCreateModuleSource(modulePath, normalizedName);

  return {
    modulePath,
    source: buildUpdatedModuleSource(moduleSource, arrayKey, className, importPath),
  };
}

export function runGenerateCommand(kind: GeneratorKind, name: string, baseDirectory: string, options: GenerateOptions = {}): string[] {
  const normalizedName = name.trim();
  const kebab = assertValidResourceName(normalizedName);
  const generator = findGeneratorDefinition(kind);

  const resolvedBase = resolve(baseDirectory);
  const domainDirectory = join(resolvedBase, toPlural(kebab));
  const files = generator.factory(normalizedName, options);
  const moduleRegistration = 'moduleRegistration' in generator ? generator.moduleRegistration : undefined;

  const moduleUpdate = moduleRegistration
    ? prepareModuleUpdate(domainDirectory, normalizedName, kind, moduleRegistration.classSuffix, moduleRegistration.arrayKey)
    : undefined;

  mkdirSync(domainDirectory, { recursive: true });

  const writtenPaths = files.map((file) => {
    const filePath = join(domainDirectory, file.path);

    if (!options.force && existsSync(filePath)) {
      return null;
    }

    writeFileSync(filePath, file.content, 'utf8');
    return filePath;
  }).filter((filePath): filePath is string => filePath !== null);

  if (moduleUpdate) {
    writeFileSync(moduleUpdate.modulePath, moduleUpdate.source, 'utf8');

    if (!writtenPaths.includes(moduleUpdate.modulePath)) {
      writtenPaths.push(moduleUpdate.modulePath);
    }
  }

  return writtenPaths;
}
