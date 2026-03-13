import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGenerateCommand } from './commands/generate';
import type { GenerateOptions, GeneratorKind, GeneratorPreset } from './types';

type CliStream = {
  write(message: string): unknown;
};

export interface CliRuntimeOptions {
  cwd?: string;
  stderr?: CliStream;
  stdout?: CliStream;
}

type ParsedCliArgs = {
  kind: GeneratorKind;
  name: string;
  options: GenerateOptions;
  targetDirectory?: string;
};

const GENERATOR_KINDS: GeneratorKind[] = ['controller', 'dto', 'module', 'repo', 'service'];
const PRESETS: GeneratorPreset[] = ['drizzle', 'generic', 'prisma'];

function isGeneratorKind(value: string): value is GeneratorKind {
  return GENERATOR_KINDS.includes(value as GeneratorKind);
}

function isGeneratorPreset(value: string): value is GeneratorPreset {
  return PRESETS.includes(value as GeneratorPreset);
}

function usage(): string {
  return [
    'Usage: konekti g <kind> <name> [--preset <generic|prisma|drizzle>] [--target-directory <path>]',
    'Aliases: konekti generate <kind> <name>',
  ].join('\n');
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function readPresetFromPackageJson(filePath: string): GeneratorPreset | undefined {
  const packageJson = readJson(filePath) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  if (dependencies['@konekti/prisma']) {
    return 'prisma';
  }

  if (dependencies['@konekti/drizzle']) {
    return 'drizzle';
  }

  return undefined;
}

function detectPreset(startDirectory: string): GeneratorPreset {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    const packageJsonPath = join(currentDirectory, 'package.json');

    if (existsSync(packageJsonPath)) {
      const detectedPreset = readPresetFromPackageJson(packageJsonPath);

      if (detectedPreset) {
        return detectedPreset;
      }
    }

    const appsDirectory = join(currentDirectory, 'apps');

    if (existsSync(appsDirectory)) {
      const presets = new Set<GeneratorPreset>();

      for (const entry of readdirSync(appsDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }

        const appPackageJson = join(appsDirectory, entry.name, 'package.json');

        if (!existsSync(appPackageJson)) {
          continue;
        }

        const detectedPreset = readPresetFromPackageJson(appPackageJson);

        if (detectedPreset) {
          presets.add(detectedPreset);
        }
      }

      if (presets.size === 1) {
        return [...presets][0] ?? 'generic';
      }
    }

    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return 'generic';
    }

    currentDirectory = parentDirectory;
  }
}

function resolveDefaultTargetDirectory(startDirectory: string): string {
  const resolvedStartDirectory = resolve(startDirectory);

  if (existsSync(join(resolvedStartDirectory, 'package.json')) && existsSync(join(resolvedStartDirectory, 'src'))) {
    return join(resolvedStartDirectory, 'src');
  }

  if (existsSync(join(resolvedStartDirectory, 'apps'))) {
    const appDirectories = readdirSync(join(resolvedStartDirectory, 'apps'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(resolvedStartDirectory, 'apps', entry.name))
      .filter((directory) => existsSync(join(directory, 'package.json')) && existsSync(join(directory, 'src')));

    if (appDirectories.length === 1) {
      return join(appDirectories[0], 'src');
    }
  }

  return resolvedStartDirectory;
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const [command, rawKind, name, ...optionArgs] = argv;

  if (!(command === 'g' || command === 'generate')) {
    throw new Error(usage());
  }

  if (!rawKind || !isGeneratorKind(rawKind) || !name) {
    throw new Error(usage());
  }

  const parsedOptions: GenerateOptions = {};
  let targetDirectory: string | undefined;

  for (let index = 0; index < optionArgs.length; index += 1) {
    const option = optionArgs[index];
    const next = optionArgs[index + 1];

    if (option === '--preset' || option === '-p') {
      if (!next || !isGeneratorPreset(next)) {
        throw new Error('Expected --preset to be one of: generic, prisma, drizzle.');
      }

      parsedOptions.preset = next;
      index += 1;
      continue;
    }

    if (option === '--target-directory' || option === '-o') {
      if (!next) {
        throw new Error('Expected --target-directory to have a value.');
      }

      targetDirectory = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${option}`);
  }

  return {
    kind: rawKind,
    name,
    options: parsedOptions,
    targetDirectory,
  };
}

export function runCli(argv = process.argv.slice(2), runtime: CliRuntimeOptions = {}): number {
  const cwd = runtime.cwd ? resolve(runtime.cwd) : process.cwd();
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;

  try {
    const parsed = parseCliArgs(argv);
    const targetDirectory = resolve(cwd, parsed.targetDirectory ?? resolveDefaultTargetDirectory(cwd));

    mkdirSync(targetDirectory, { recursive: true });

    const files = runGenerateCommand(parsed.kind, parsed.name, targetDirectory, {
      ...parsed.options,
      preset: parsed.options.preset ?? detectPreset(cwd),
    });

    stdout.write(`Generated ${files.length} file(s):\n`);
    for (const file of files) {
      stdout.write(`- ${file}\n`);
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = runCli();
}
