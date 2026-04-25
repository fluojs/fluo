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

/** Describes how one generated artifact would interact with the workspace. */
export type GeneratePlanAction = 'create' | 'module-create' | 'module-unchanged' | 'module-update' | 'overwrite' | 'skip' | 'unchanged';

/** One path-level action reported by generate dry-run previews and structured results. */
export type GeneratePlanEntry = {
  /** Planned action for this path. */
  action: GeneratePlanAction;
  /** Absolute path affected by the plan entry. */
  path: string;
};

function planFileWrite(filePath: string, content: string, options: GenerateOptions): GeneratePlanEntry {
  if (!existsSync(filePath)) {
    return { action: 'create', path: filePath };
  }

  if (!options.force) {
    return { action: 'skip', path: filePath };
  }

  if (readFileSync(filePath, 'utf8') === content) {
    return { action: 'unchanged', path: filePath };
  }

  return { action: 'overwrite', path: filePath };
}

function planModuleWrite(modulePath: string, content: string): GeneratePlanEntry {
  if (!existsSync(modulePath)) {
    return { action: 'module-create', path: modulePath };
  }

  if (readFileSync(modulePath, 'utf8') === content) {
    return { action: 'module-unchanged', path: modulePath };
  }

  return { action: 'module-update', path: modulePath };
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

function resolveDomainDirectory(kind: GeneratorKind, resolvedBase: string, kebab: string, options: GenerateOptions): string {
  if (kind === 'request-dto' && options.targetFeature !== undefined) {
    const normalizedFeature = options.targetFeature.trim();
    const featureKebab = assertValidResourceName(normalizedFeature);
    const featureDirectory = /^[A-Z]/u.test(normalizedFeature) ? toPlural(featureKebab) : featureKebab;

    return join(resolvedBase, featureDirectory);
  }

  return join(resolvedBase, toPlural(kebab));
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

/**
 * Structured result returned by {@link runGenerateCommand} for tooling-friendly automation.
 *
 * `generatedFiles` only includes files whose on-disk content changed during the command.
 * `moduleRegistered` reports whether the target schematic participates in automatic module wiring,
 * even when the target module file was already up to date.
 */
export type GenerateResult = {
  generatedFiles: string[];
  moduleRegistered: boolean;
  modulePath: string | undefined;
  nextStepHint: string;
  plannedFiles: GeneratePlanEntry[];
  wiringBehavior: GeneratorManifestEntry['wiringBehavior'];
};

/**
 * Generates one CLI schematic into a source directory and returns structured wiring metadata.
 *
 * The command keeps generation idempotent where possible: unchanged files are not rewritten, and
 * auto-registered schematics reuse an existing module file when it already contains the required import
 * and registration entry.
 *
 * @example
 * ```ts
 * const result = runGenerateCommand('service', 'Post', './src');
 *
 * console.log(result.wiringBehavior);
 * console.log(result.nextStepHint);
 * ```
 *
 * @param kind Generator kind to execute.
 * @param name Resource name supplied by the caller before normalization.
 * @param baseDirectory Source directory that should receive the generated domain folder.
 * @param options Optional generation flags that control overwrites, request DTO feature placement, and sibling-aware templates.
 * @returns Structured file and wiring metadata for the completed generation run.
 * @throws {Error} When the resource name is invalid, the generator kind is unknown, or the target module source cannot be updated safely.
 */
export function runGenerateCommand(kind: GeneratorKind, name: string, baseDirectory: string, options: GenerateOptions = {}): GenerateResult {
  const normalizedName = name.trim();
  const kebab = assertValidResourceName(normalizedName);
  const generator = findGeneratorDefinition(kind);

  const resolvedBase = resolve(baseDirectory);
  const domainDirectory = resolveDomainDirectory(kind, resolvedBase, kebab, options);
  const generatorOptions = createGeneratorOptions(kind, domainDirectory, kebab, options);
  const files = generator.factory(normalizedName, generatorOptions);
  const moduleRegistration = 'moduleRegistration' in generator ? generator.moduleRegistration : undefined;

  const moduleUpdate = moduleRegistration
    ? prepareModuleUpdate(domainDirectory, normalizedName, kind, moduleRegistration.classSuffix, moduleRegistration.arrayKey)
    : undefined;

  const plannedFiles = files.map((file) => planFileWrite(join(domainDirectory, file.path), file.content, options));
  const modulePlan = moduleUpdate ? planModuleWrite(moduleUpdate.modulePath, moduleUpdate.source) : undefined;

  if (options.dryRun) {
    return {
      generatedFiles: [],
      moduleRegistered: moduleUpdate !== undefined,
      modulePath: moduleUpdate?.modulePath,
      nextStepHint: generator.nextStepHint,
      plannedFiles: modulePlan ? [...plannedFiles, modulePlan] : plannedFiles,
      wiringBehavior: generator.wiringBehavior,
    };
  }

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
    plannedFiles: modulePlan ? [...plannedFiles, modulePlan] : plannedFiles,
    wiringBehavior: generator.wiringBehavior,
  };
}
