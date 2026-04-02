import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';

import type { GenerateOptions, GeneratorKind } from '../types.js';
import type { GeneratorManifestEntry, ModuleArrayKey } from '../generators/manifest.js';
import { findGeneratorDefinition } from '../generators/manifest.js';

import { ensureModuleImport, generateModuleFiles, registerInModule } from '../generators/module.js';
import { toKebabCase, toPascalCase, toPlural } from '../generators/utils.js';

function writeFileIfChanged(filePath: string, content: string): boolean {
  if (existsSync(filePath) && readFileSync(filePath, 'utf8') === content) {
    return false;
  }

  writeFileSync(filePath, content, 'utf8');
  return true;
}

function createGeneratorOptions(
  kind: GeneratorKind,
  domainDirectory: string,
  kebab: string,
  options: GenerateOptions,
): GenerateOptions {
  return {
    ...options,
    hasRepo: options.hasRepo ?? (kind === 'service' ? existsSync(join(domainDirectory, `${kebab}.repo.ts`)) : undefined),
    hasService: options.hasService ?? (kind === 'controller' ? existsSync(join(domainDirectory, `${kebab}.service.ts`)) : undefined),
  };
}

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

export type GenerateResult = {
  generatedFiles: string[];
  moduleRegistered: boolean;
  modulePath: string | undefined;
  nextStepHint: string;
  wiringBehavior: GeneratorManifestEntry['wiringBehavior'];
};

export function runGenerateCommand(kind: GeneratorKind, name: string, baseDirectory: string, options: GenerateOptions = {}): GenerateResult {
  const normalizedName = name.trim();
  const kebab = assertValidResourceName(normalizedName);
  const generator = findGeneratorDefinition(kind);

  const resolvedBase = resolve(baseDirectory);
  const domainDirectory = join(resolvedBase, toPlural(kebab));
  const generatorOptions = createGeneratorOptions(kind, domainDirectory, kebab, options);
  const files = generator.factory(normalizedName, generatorOptions);
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

    return writeFileIfChanged(filePath, file.content) ? filePath : null;
  }).filter((filePath): filePath is string => filePath !== null);

  let moduleRegistered = false;
  let resolvedModulePath: string | undefined;

  if (moduleUpdate && writeFileIfChanged(moduleUpdate.modulePath, moduleUpdate.source)) {
    moduleRegistered = true;
    resolvedModulePath = moduleUpdate.modulePath;

    if (!writtenPaths.includes(moduleUpdate.modulePath)) {
      writtenPaths.push(moduleUpdate.modulePath);
    }
  } else if (moduleUpdate) {
    moduleRegistered = true;
    resolvedModulePath = moduleUpdate.modulePath;
  }

  return {
    generatedFiles: writtenPaths,
    moduleRegistered: moduleRegistered,
    modulePath: resolvedModulePath,
    nextStepHint: generator.nextStepHint,
    wiringBehavior: generator.wiringBehavior,
  };
}
