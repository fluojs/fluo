import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as clack from '@clack/prompts';
import {
  FluoFactory,
  type BootstrapTimingDiagnostics,
  type ModuleType,
  type PlatformDiagnosticIssue,
  type PlatformShell,
  type PlatformShellSnapshot,
  PLATFORM_SHELL,
} from '@fluojs/runtime';

import { renderAliasList, renderHelpTable } from '../help.js';

type CliStream = {
  write(message: string): unknown;
};

type InspectPrompter = {
  close?(): void;
  confirm(message: string, defaultValue: boolean): Promise<boolean>;
};

type ReadableStream = {
  isTTY?: boolean;
};

type StudioMermaidRenderer = (snapshot: PlatformShellSnapshot) => string;

type StudioMermaidRendererLoader = (cwd: string) => Promise<StudioMermaidRenderer | undefined>;

/**
 * Runtime options for the inspect command when used programmatically.
 */
export interface InspectCommandRuntimeOptions {
  /** Whether the caller is running under CI/non-interactive automation. */
  ci?: boolean;
  /** Current working directory for module resolution. */
  cwd?: string;
  /** Force or disable interactive prompts for optional Studio guidance. */
  interactive?: boolean;
  /** Optional test/editor hook for resolving Studio's Mermaid renderer. */
  loadStudioMermaidRenderer?: StudioMermaidRendererLoader;
  /** Custom prompt implementation used only when Studio is missing for Mermaid output. */
  prompt?: InspectPrompter;
  /** Custom stream for error output. */
  stderr?: CliStream;
  /** Custom stream for terminal detection. */
  stdin?: ReadableStream;
  /** Custom stream for standard output. */
  stdout?: CliStream;
}

type ParsedInspectArgs = {
  exportName: string;
  json: boolean;
  mermaid: boolean;
  modulePath: string;
  outputPath?: string;
  report: boolean;
  timing: boolean;
};

type InspectReport = {
  generatedAt: string;
  snapshot: PlatformShellSnapshot;
  summary: {
    componentCount: number;
    diagnosticCount: number;
    errorCount: number;
    healthStatus: PlatformShellSnapshot['health']['status'];
    readinessStatus: PlatformShellSnapshot['readiness']['status'];
    timingTotalMs: number;
    warningCount: number;
  };
  timing: BootstrapTimingDiagnostics;
  version: 1;
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
    description: 'Emit a Mermaid graph through the optional @fluojs/studio rendering contract.',
    option: '--mermaid',
  },
  {
    aliases: [],
    description: 'Bootstrap the application context and emit versioned timing diagnostics.',
    option: '--timing',
  },
  {
    aliases: [],
    description: 'Emit a CI-friendly JSON report with summary, snapshot, diagnostics, and timing.',
    option: '--report',
  },
  {
    aliases: [],
    description: 'Write the selected inspect payload to a file instead of stdout.',
    option: '--output <path>',
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

const STUDIO_CONTRACT_ENTRYPOINT = '@fluojs/studio/contracts';
const STUDIO_MISSING_MESSAGE = [
  'Mermaid graph rendering is owned by @fluojs/studio, but @fluojs/studio is not resolvable from this project.',
  'Install @fluojs/studio explicitly (for example: pnpm add -D @fluojs/studio) and rerun fluo inspect --mermaid.',
].join('\n');

function isHelpFlag(value: string | undefined): boolean {
  return value === '--help' || value === '-h';
}

/**
 * Returns the usage information string for the inspect command.
 *
 * @returns Formatted help text including usage and options.
 */
export function inspectUsage(): string {
  return [
    'Usage: fluo inspect <module-path> [options]',
    '',
    'Options',
    renderHelpTable(INSPECT_OPTION_HELP, [
      { header: 'Option', render: (entry) => entry.option },
      { header: 'Aliases', render: (entry) => renderAliasList(entry.aliases) },
      { header: 'Description', render: (entry) => entry.description },
    ]),
    '',
    'Docs: https://github.com/fluojs/fluo/tree/main/docs/getting-started/quick-start.md',
  ].join('\n');
}

function parseInspectArgs(argv: string[]): ParsedInspectArgs {
  let modulePath: string | undefined;
  let exportName = 'AppModule';
  let json = false;
  let mermaid = false;
  let outputPath: string | undefined;
  let report = false;
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

    if (option === '--report') {
      report = true;
      continue;
    }

    if (option === '--output') {
      const next = argv[index + 1];
      if (!next || next.startsWith('-')) {
        throw new Error('Expected --output to have a file path value.');
      }

      outputPath = next;
      index += 1;
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

  if (!json && !mermaid && !timing && !report) {
    json = true;
  }

  const selectedModes = [json, mermaid, report].filter(Boolean).length;

  if (selectedModes > 1) {
    throw new Error('Choose only one inspect output mode: --json, --mermaid, or --report.');
  }

  if (mermaid && timing) {
    throw new Error('Use --timing only with JSON inspect output or --report. Mermaid rendering remains delegated to @fluojs/studio.');
  }

  return {
    exportName,
    json,
    mermaid,
    modulePath,
    outputPath,
    report,
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

function createEmptyTimingDiagnostics(): BootstrapTimingDiagnostics {
  return {
    phases: [],
    totalMs: 0,
    version: 1,
  };
}

function createInspectReport(snapshot: PlatformShellSnapshot, timing: BootstrapTimingDiagnostics | undefined): InspectReport {
  const resolvedTiming = timing ?? createEmptyTimingDiagnostics();
  const errorCount = snapshot.diagnostics.filter((diagnostic: PlatformDiagnosticIssue) => diagnostic.severity === 'error').length;
  const warningCount = snapshot.diagnostics.filter((diagnostic: PlatformDiagnosticIssue) => diagnostic.severity === 'warning').length;

  return {
    generatedAt: snapshot.generatedAt,
    snapshot,
    summary: {
      componentCount: snapshot.components.length,
      diagnosticCount: snapshot.diagnostics.length,
      errorCount,
      healthStatus: snapshot.health.status,
      readinessStatus: snapshot.readiness.status,
      timingTotalMs: resolvedTiming.totalMs,
      warningCount,
    },
    timing: resolvedTiming,
    version: 1,
  };
}

function stringifySnapshotWithTiming(snapshot: PlatformShellSnapshot, timing: BootstrapTimingDiagnostics | undefined): string {
  return JSON.stringify({
    snapshot,
    timing: timing ?? createEmptyTimingDiagnostics(),
  }, null, 2);
}

async function emitInspectPayload(payload: string, parsed: ParsedInspectArgs, cwd: string, stdout: CliStream): Promise<void> {
  if (!parsed.outputPath) {
    stdout.write(`${payload}\n`);
    return;
  }

  const outputPath = resolve(cwd, parsed.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${payload}\n`, 'utf8');
}

function createInspectPrompter(): InspectPrompter {
  return {
    async confirm(message: string, defaultValue: boolean): Promise<boolean> {
      const result = await clack.confirm({
        initialValue: defaultValue,
        message,
      });

      if (clack.isCancel(result)) {
        clack.cancel('Operation cancelled.');
        process.exit(0);
      }

      return result;
    },
  };
}

function shouldPromptForStudio(runtime: InspectCommandRuntimeOptions): boolean {
  if (runtime.prompt !== undefined) {
    return runtime.interactive ?? true;
  }

  if (runtime.ci === true) {
    return false;
  }

  return runtime.stdout === undefined
    && runtime.stderr === undefined
    && (runtime.interactive ?? true)
    && Boolean(runtime.stdin?.isTTY ?? process.stdin.isTTY);
}

async function loadStudioMermaidRenderer(cwd: string): Promise<StudioMermaidRenderer | undefined> {
  const resolvers = [
    createRequire(resolve(cwd, 'package.json')),
    createRequire(import.meta.url),
  ];

  for (const resolver of resolvers) {
    try {
      const resolvedEntrypoint = resolver.resolve(STUDIO_CONTRACT_ENTRYPOINT);
      const importedContract = await import(pathToFileURL(resolvedEntrypoint).href) as { renderMermaid?: unknown };

      if (typeof importedContract.renderMermaid !== 'function') {
        throw new Error(`${STUDIO_CONTRACT_ENTRYPOINT} does not export renderMermaid(snapshot).`);
      }

      return importedContract.renderMermaid as StudioMermaidRenderer;
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (code !== 'MODULE_NOT_FOUND' && code !== 'ERR_MODULE_NOT_FOUND') {
        throw error;
      }
    }
  }

  return undefined;
}

async function resolveStudioMermaidRenderer(cwd: string, runtime: InspectCommandRuntimeOptions): Promise<StudioMermaidRenderer> {
  const renderer = await (runtime.loadStudioMermaidRenderer ?? loadStudioMermaidRenderer)(cwd);

  if (renderer) {
    return renderer;
  }

  if (!shouldPromptForStudio(runtime)) {
    throw new Error(STUDIO_MISSING_MESSAGE);
  }

  const prompt = runtime.prompt ?? createInspectPrompter();
  try {
    const approvedInstall = await prompt.confirm('Install @fluojs/studio before rendering Mermaid output?', false);

    if (!approvedInstall) {
      throw new Error(`${STUDIO_MISSING_MESSAGE}\nInstallation declined; no package-manager command was run.`);
    }

    throw new Error(`${STUDIO_MISSING_MESSAGE}\nAutomatic installation is not run by fluo inspect. Install @fluojs/studio explicitly, then rerun the command.`);
  } finally {
    prompt.close?.();
  }
}

/**
 * Executes the inspect command to visualize the application module graph.
 *
 * @param argv Command line arguments.
 * @param runtime Optional custom runtime configuration for output streams and working directory.
 * @returns Exit code (0 for success, 1 for failure).
 */
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

    if (parsed.timing && !parsed.json && !parsed.report) {
      const context = await FluoFactory.createApplicationContext(rootModule, {
        diagnostics: { timing: true },
        logger: {
          debug() {},
          error() {},
          log() {},
          warn() {},
        },
      });

      try {
        await emitInspectPayload(stringifyTiming(context.bootstrapTiming), parsed, cwd, stdout);
      } finally {
        await context.close();
      }

      return 0;
    }

    const context = await FluoFactory.createApplicationContext(rootModule, {
      diagnostics: parsed.timing || parsed.report ? { timing: true } : undefined,
      logger: {
        debug() {},
        error() {},
        log() {},
        warn() {},
      },
    });

    try {
      const platformShell = await context.get<PlatformShell>(PLATFORM_SHELL);
      const snapshot = await platformShell.snapshot();

      if (parsed.json) {
        await emitInspectPayload(parsed.timing ? stringifySnapshotWithTiming(snapshot, context.bootstrapTiming) : stringifySnapshot(snapshot), parsed, cwd, stdout);
      }

      if (parsed.report) {
        await emitInspectPayload(JSON.stringify(createInspectReport(snapshot, context.bootstrapTiming), null, 2), parsed, cwd, stdout);
      }

      if (parsed.mermaid) {
        const renderMermaid = await resolveStudioMermaidRenderer(cwd, runtime);
        await emitInspectPayload(renderMermaid(snapshot), parsed, cwd, stdout);
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
