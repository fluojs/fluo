import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import {
  KonektiFactory,
  type BootstrapTimingDiagnostics,
  type ModuleType,
  type PlatformShellSnapshot,
  PLATFORM_SHELL,
} from '@fluojs/runtime';

import { renderAliasList, renderHelpTable } from '../help.js';

type CliStream = {
  write(message: string): unknown;
};

export interface InspectCommandRuntimeOptions {
  cwd?: string;
  stderr?: CliStream;
  stdout?: CliStream;
}

type ParsedInspectArgs = {
  exportName: string;
  json: boolean;
  mermaid: boolean;
  modulePath: string;
  timing: boolean;
};

type InspectOptionHelpEntry = {
  aliases: string[];
  description: string;
  option: string;
};

const INSPECT_OPTION_HELP: InspectOptionHelpEntry[] = [
  {
    aliases: [],
    description: 'Emit the runtime platform snapshot/diagnostics payload as JSON (default when no output mode is selected).',
    option: '--json',
  },
  {
    aliases: [],
    description: 'Emit platform component dependency chains as a Mermaid diagram.',
    option: '--mermaid',
  },
  {
    aliases: [],
    description: 'Bootstrap the application context and emit versioned timing diagnostics.',
    option: '--timing',
  },
  {
    aliases: [],
    description: 'Select the exported module symbol name (default: AppModule).',
    option: '--export <name>',
  },
  {
    aliases: ['-h'],
    description: 'Show help for the inspect command.',
    option: '--help',
  },
];

function isHelpFlag(value: string | undefined): boolean {
  return value === '--help' || value === '-h';
}

export function inspectUsage(): string {
  return [
    'Usage: konekti inspect <module-path> [options]',
    '',
    'Options',
    renderHelpTable(INSPECT_OPTION_HELP, [
      { header: 'Option', render: (entry) => entry.option },
      { header: 'Aliases', render: (entry) => renderAliasList(entry.aliases) },
      { header: 'Description', render: (entry) => entry.description },
    ]),
    '',
    'Docs: https://github.com/konektijs/konekti/tree/main/docs/getting-started/quick-start.md',
  ].join('\n');
}

function parseInspectArgs(argv: string[]): ParsedInspectArgs {
  let modulePath: string | undefined;
  let exportName = 'AppModule';
  let json = false;
  let mermaid = false;
  let timing = false;

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];

    if (!option) {
      continue;
    }

    if (option === '--json') {
      json = true;
      continue;
    }

    if (option === '--mermaid') {
      mermaid = true;
      continue;
    }

    if (option === '--timing') {
      timing = true;
      continue;
    }

    if (option === '--export') {
      const next = argv[index + 1];
      if (!next || next.startsWith('-')) {
        throw new Error('Expected --export to have a symbol name value.');
      }

      exportName = next;
      index += 1;
      continue;
    }

    if (option.startsWith('-')) {
      throw new Error(`Unknown option for inspect command: ${option}`);
    }

    if (modulePath) {
      throw new Error(`Unexpected extra positional argument: ${option}`);
    }

    modulePath = option;
  }

  if (!modulePath) {
    throw new Error(inspectUsage());
  }

  if (!json && !mermaid && !timing) {
    json = true;
  }

  const selectedModes = [json, mermaid, timing].filter(Boolean).length;

  if (selectedModes > 1) {
    throw new Error('Choose only one inspect output mode: --json, --mermaid, or --timing.');
  }

  return {
    exportName,
    json,
    mermaid,
    modulePath,
    timing,
  };
}

function resolveRootModule(exportedValue: unknown, exportName: string): ModuleType {
  if (typeof exportedValue !== 'function') {
    throw new Error(`Export "${exportName}" is not a module class constructor.`);
  }

  return exportedValue as ModuleType;
}

function stringifyTiming(timing: BootstrapTimingDiagnostics | undefined): string {
  const value = timing ?? {
    phases: [],
    totalMs: 0,
    version: 1 as const,
  };

  return JSON.stringify(value, null, 2);
}

function stringifySnapshot(snapshot: PlatformShellSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

function renderPlatformSnapshotMermaid(snapshot: PlatformShellSnapshot): string {
  const lines: string[] = ['graph TD'];

  if (snapshot.components.length === 0) {
    lines.push('  EMPTY["No registered platform components"]');
    return lines.join('\n');
  }

  const nodeByComponentId = new Map<string, string>();

  for (const [index, component] of snapshot.components.entries()) {
    const nodeId = `C${String(index + 1)}`;
    nodeByComponentId.set(component.id, nodeId);

    const summary = [
      component.id,
      `kind: ${component.kind}`,
      `state: ${component.state}`,
      `readiness: ${component.readiness.status}`,
      `health: ${component.health.status}`,
    ].join('\\n');

    lines.push(`  ${nodeId}["${summary}"]`);
  }

  for (const component of snapshot.components) {
    const from = nodeByComponentId.get(component.id);
    if (!from) {
      continue;
    }

    for (const dependency of component.dependencies) {
      const to = nodeByComponentId.get(dependency);
      if (!to) {
        continue;
      }

      lines.push(`  ${from} --> ${to}`);
    }
  }

  return lines.join('\n');
}

export async function runInspectCommand(argv: string[], runtime: InspectCommandRuntimeOptions = {}): Promise<number> {
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;
  const cwd = runtime.cwd ?? process.cwd();

  try {
    if (argv.some(isHelpFlag)) {
      stdout.write(`${inspectUsage()}\n`);
      return 0;
    }

    const parsed = parseInspectArgs(argv);
    const modulePath = resolve(cwd, parsed.modulePath);
    const importedModule = await import(pathToFileURL(modulePath).href);
    const rootModule = resolveRootModule(importedModule[parsed.exportName], parsed.exportName);

    if (parsed.timing) {
      const context = await KonektiFactory.createApplicationContext(rootModule, {
        diagnostics: { timing: true },
        logger: {
          debug() {},
          error() {},
          log() {},
          warn() {},
        },
      });

      try {
        stdout.write(`${stringifyTiming(context.bootstrapTiming)}\n`);
      } finally {
        await context.close();
      }

      return 0;
    }

    const context = await KonektiFactory.createApplicationContext(rootModule, {
      logger: {
        debug() {},
        error() {},
        log() {},
        warn() {},
      },
    });

    try {
      const platformShell = await context.get(PLATFORM_SHELL);
      const snapshot = await platformShell.snapshot();

      if (parsed.json) {
        stdout.write(`${stringifySnapshot(snapshot)}\n`);
      }

      if (parsed.mermaid) {
        stdout.write(`${renderPlatformSnapshotMermaid(snapshot)}\n`);
      }
    } finally {
      await context.close();
    }

    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    return 1;
  }
}
