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

function updateModuleFile(modulePath: string, arrayKey: ModuleArrayKey, className: string, importPath: string): void {
  let source = readFileSync(modulePath, 'utf8');
  source = ensureModuleImport(source, className, importPath);
  source = registerInModule(source, arrayKey, className);
  writeFileSync(modulePath, source, 'utf8');
}

export function runGenerateCommand(kind: GeneratorKind, name: string, baseDirectory: string, options: GenerateOptions = {}): string[] {
  const normalizedName = name.trim();
  const kebab = assertValidResourceName(normalizedName);
  const generator = findGeneratorDefinition(kind);

  const resolvedBase = resolve(baseDirectory);
  const domainDirectory = join(resolvedBase, toPlural(kebab));

  mkdirSync(domainDirectory, { recursive: true });

  const files = generator.factory(normalizedName, options);

  const writtenPaths = files.map((file) => {
    const filePath = join(domainDirectory, file.path);

    if (!options.force && existsSync(filePath)) {
      return null;
    }

    writeFileSync(filePath, file.content, 'utf8');
    return filePath;
  }).filter((filePath): filePath is string => filePath !== null);

  const moduleRegistration = 'moduleRegistration' in generator ? generator.moduleRegistration : undefined;
  if (moduleRegistration) {
    const modulePath = ensureModuleFile(domainDirectory, normalizedName);
    const className = `${toPascalCase(normalizedName)}${moduleRegistration.classSuffix}`;
    const importPath = `${kebab}.${kind}`;
    updateModuleFile(modulePath, moduleRegistration.arrayKey, className, importPath);

    if (!writtenPaths.includes(modulePath)) {
      writtenPaths.push(modulePath);
    }
  }

  return writtenPaths;
}
