import { resolve } from 'node:path';

import { renderAliasList, renderHelpTable } from '../help.js';
import {
  MIGRATION_TRANSFORMS,
  renderTransformList,
  runNestJsMigration,
  type MigrationTransformKind,
} from '../transforms/nestjs-migrate.js';

type CliStream = {
  write(message: string): unknown;
};

export interface MigrateCommandRuntimeOptions {
  cwd?: string;
  stderr?: CliStream;
  stdout?: CliStream;
}

type MigrateOptionHelpEntry = {
  aliases: string[];
  description: string;
  option: string;
};

type ParsedMigrateArgs = {
  apply: boolean;
  path: string;
  transforms: Set<MigrationTransformKind>;
};

const MIGRATE_OPTION_HELP: MigrateOptionHelpEntry[] = [
  {
    aliases: ['-a'],
    description: 'Apply file changes. Dry-run is the default mode.',
    option: '--apply',
  },
  {
    aliases: [],
    description: `Run only selected transforms. Available: ${MIGRATION_TRANSFORMS.join(', ')}.`,
    option: '--only <comma-list>',
  },
  {
    aliases: [],
    description: `Skip selected transforms. Available: ${MIGRATION_TRANSFORMS.join(', ')}.`,
    option: '--skip <comma-list>',
  },
  {
    aliases: ['-h'],
    description: 'Show help for the migrate command.',
    option: '--help',
  },
];

function isHelpFlag(value: string | undefined): boolean {
  return value === '--help' || value === '-h';
}

function parseTransformList(rawValue: string, optionName: '--only' | '--skip'): MigrationTransformKind[] {
  const values = rawValue
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (values.length === 0) {
    throw new Error(`${optionName} requires a non-empty comma-separated transform list.`);
  }

  const invalid = values.filter((value) => !MIGRATION_TRANSFORMS.includes(value as MigrationTransformKind));
  if (invalid.length > 0) {
    throw new Error(`Unknown transform(s): ${invalid.join(', ')}. Available transforms: ${MIGRATION_TRANSFORMS.join(', ')}.`);
  }

  return values as MigrationTransformKind[];
}

function parseArgs(argv: string[]): ParsedMigrateArgs {
  let pathArgument: string | undefined;
  let apply = false;
  let onlyTransforms: MigrationTransformKind[] | undefined;
  let skipTransforms: MigrationTransformKind[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--apply' || arg === '-a') {
      apply = true;
      continue;
    }

    if (arg === '--only' || arg === '--skip') {
      const rawValue = argv[index + 1];
      if (!rawValue || rawValue.startsWith('-')) {
        throw new Error(`Expected ${arg} to have a comma-separated value.`);
      }

      const parsed = parseTransformList(rawValue, arg);
      if (arg === '--only') {
        if (onlyTransforms) {
          throw new Error('Duplicate --only option.');
        }

        onlyTransforms = parsed;
      } else {
        skipTransforms = [...skipTransforms, ...parsed];
      }

      index += 1;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option for migrate command: ${arg}`);
    }

    if (pathArgument) {
      throw new Error(`Unexpected extra positional argument: ${arg}`);
    }

    pathArgument = arg;
  }

  if (!pathArgument) {
    throw new Error(migrateUsage());
  }

  const enabled = new Set<MigrationTransformKind>(onlyTransforms ?? MIGRATION_TRANSFORMS);
  for (const skipped of skipTransforms) {
    enabled.delete(skipped);
  }

  if (enabled.size === 0) {
    throw new Error('No transforms remain after applying --only/--skip filters.');
  }

  return {
    apply,
    path: pathArgument,
    transforms: enabled,
  };
}

export function migrateUsage(): string {
  return [
    'Usage: konekti migrate <path> [options]',
    '',
    'Options',
    renderHelpTable(MIGRATE_OPTION_HELP, [
      { header: 'Option', render: (entry) => entry.option },
      { header: 'Aliases', render: (entry) => renderAliasList(entry.aliases) },
      { header: 'Description', render: (entry) => entry.description },
    ]),
    '',
    'Docs: https://github.com/konektijs/konekti/tree/main/docs/getting-started/migrate-from-nestjs.md',
  ].join('\n');
}

export async function runMigrateCommand(argv: string[], runtime: MigrateCommandRuntimeOptions = {}): Promise<number> {
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;

  try {
    if (argv.some(isHelpFlag)) {
      stdout.write(`${migrateUsage()}\n`);
      return 0;
    }

    const parsed = parseArgs(argv);
    const targetPath = resolve(runtime.cwd ?? process.cwd(), parsed.path);
    const transforms = [...parsed.transforms];
    const report = runNestJsMigration({
      apply: parsed.apply,
      enabledTransforms: parsed.transforms,
      targetPath,
    });

    stdout.write(`Mode: ${parsed.apply ? 'apply' : 'dry-run'}\n`);
    stdout.write(`Enabled transforms: ${renderTransformList(transforms)}\n`);
    stdout.write(`Scanned files: ${report.scannedFiles}\n`);
    stdout.write(`Changed files: ${report.changedFiles}\n`);
    stdout.write(`Warnings: ${report.warningCount}\n`);

    if (!parsed.apply && report.changedFiles > 0) {
      stdout.write('Run again with --apply to write transformed files.\n');
    }

    const changedPaths = report.fileResults
      .filter((fileResult) => fileResult.changed)
      .map((fileResult) => fileResult.filePath);

    if (changedPaths.length > 0) {
      stdout.write('Changed file(s):\n');
      for (const filePath of changedPaths) {
        stdout.write(`- ${filePath}\n`);
      }
    }

    const manualFollowUps = report.fileResults.flatMap((fileResult) => fileResult.warnings);
    if (manualFollowUps.length > 0) {
      stdout.write('Manual follow-up warnings:\n');
      for (const warning of manualFollowUps) {
        stdout.write(`- ${warning.filePath}:${warning.line} ${warning.message}\n`);
      }
    }

    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    return 1;
  }
}
