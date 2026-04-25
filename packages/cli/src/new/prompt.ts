import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import * as clack from '@clack/prompts';

import { resolveBootstrapSchema } from './resolver.js';
import {
  DOCUMENTED_MICROSERVICE_TRANSPORTS,
  getApplicationStarterProfiles,
} from './starter-profiles.js';
import type { BootstrapAnswers, PackageManager } from './types.js';

/** Default package manager used when detection has no signal. */
export const DEFAULT_PACKAGE_MANAGER: PackageManager = 'pnpm';
const DEFAULT_INSTALL_DEPENDENCIES = true;
const DEFAULT_INITIALIZE_GIT = false;

type WritableStream = {
  write(message: string): unknown;
};

type ReadableStream = {
  isTTY?: boolean;
};

type PromptChoice<T extends string> = {
  label: string;
  value: T;
};

const STARTER_SHAPE_CHOICES = [
  { label: 'Application', value: 'application' },
  { label: 'Microservice', value: 'microservice' },
  { label: 'Mixed', value: 'mixed' },
] as const;

/** Prompt contract used by the interactive `fluo new` wizard. */
export interface BootstrapPrompter {
  close?(): void;
  confirm(message: string, defaultValue: boolean): Promise<boolean>;
  select<T extends string>(message: string, choices: readonly PromptChoice<T>[], defaultValue?: T): Promise<T>;
  text(message: string): Promise<string>;
}

/** Runtime overrides for resolving bootstrap answers in tests and editors. */
export interface ResolveBootstrapAnswersOptions {
  completionMessage?: string | ((answers: BootstrapAnswers) => string);
  interactive?: boolean;
  prompt?: BootstrapPrompter;
  stdin?: ReadableStream;
  stdout?: WritableStream;
}

function resolveCompletionMessage(
  completionMessage: ResolveBootstrapAnswersOptions['completionMessage'],
  answers: BootstrapAnswers,
): string {
  if (typeof completionMessage === 'function') {
    return completionMessage(answers);
  }

  return completionMessage ?? `Project created! Run: cd ${answers.targetDirectory}`;
}

function hasOwnValue<Key extends keyof BootstrapAnswers>(
  partial: Partial<BootstrapAnswers>,
  key: Key,
): partial is Partial<BootstrapAnswers> & Required<Pick<BootstrapAnswers, Key>> {
  return partial[key] !== undefined;
}

function createBootstrapPrompter(): BootstrapPrompter {
  return {
    async confirm(message: string, defaultValue: boolean): Promise<boolean> {
      const result = await clack.confirm({
        message,
        initialValue: defaultValue,
      });

      if (clack.isCancel(result)) {
        clack.cancel('Operation cancelled.');
        process.exit(0);
      }

      return result;
    },
    async select<T extends string>(message: string, choices: readonly PromptChoice<T>[], defaultValue?: T): Promise<T> {
      const result = await clack.select({
        message,
        options: choices.map((choice) => ({ label: choice.label, value: choice.value })) as clack.Option<T>[],
        initialValue: defaultValue,
      }) as T | symbol;

      if (clack.isCancel(result)) {
        clack.cancel('Operation cancelled.');
        process.exit(0);
      }

      return result;
    },
    async text(message: string): Promise<string> {
      const result = await clack.text({
        message,
        validate(value) {
          if (!value || value.trim().length === 0) {
            return 'Value is required.';
          }
        },
      });

      if (clack.isCancel(result)) {
        clack.cancel('Operation cancelled.');
        process.exit(0);
      }

      return result;
    },
  };
}

function shouldPromptForAnswers(
  partial: Partial<BootstrapAnswers>,
  interactive: boolean,
): boolean {
  const selectedRuntime = partial.runtime;
  return interactive && (
    !hasOwnValue(partial, 'projectName')
    || !hasOwnValue(partial, 'shape')
    || !hasOwnValue(partial, 'tooling')
    || !hasOwnValue(partial, 'packageManager')
    || !hasOwnValue(partial, 'installDependencies')
    || !hasOwnValue(partial, 'initializeGit')
    || (partial.shape === 'application' && !hasOwnValue(partial, 'runtime'))
    || (partial.shape === 'application' && selectedRuntime === 'node' && !hasOwnValue(partial, 'platform'))
    || (partial.shape === 'microservice' && !hasOwnValue(partial, 'transport'))
  );
}

async function resolveInteractiveBootstrapAnswers(
  partial: Partial<BootstrapAnswers>,
  cwd: string,
  userAgent: string | undefined,
  prompt: BootstrapPrompter,
): Promise<BootstrapAnswers> {
  const answers: Partial<BootstrapAnswers> = { ...partial };
  const detectedPackageManager = detectPackageManager(cwd, userAgent);

  if (!answers.projectName) {
    answers.projectName = assertValidProjectName(await prompt.text('Project name'));
  }

  if (!answers.shape) {
    answers.shape = await prompt.select('Starter shape', STARTER_SHAPE_CHOICES, 'application');
  }

  if (answers.shape === 'application' && !answers.runtime) {
    answers.runtime = await prompt.select('Runtime', [
      { label: 'Bun', value: 'bun' },
      { label: 'Cloudflare Workers', value: 'cloudflare-workers' },
      { label: 'Deno', value: 'deno' },
      { label: 'Node.js', value: 'node' },
    ] as const, 'node');
  }

  if (answers.shape === 'application' && !answers.platform) {
    if (answers.runtime === 'node') {
      const applicationProfiles = getApplicationStarterProfiles('node');
      answers.platform = await prompt.select('HTTP platform', applicationProfiles.map((profile) => ({
        label: profile.platformPromptLabel ?? profile.schema.platform,
        value: profile.schema.platform,
      })), 'fastify');
    } else if (answers.runtime === 'bun' || answers.runtime === 'deno' || answers.runtime === 'cloudflare-workers') {
      answers.platform = answers.runtime;
    }
  }

  if (answers.shape === 'microservice' && !answers.transport) {
    answers.transport = await prompt.select(
      'Microservice transport',
      DOCUMENTED_MICROSERVICE_TRANSPORTS.map((transport) => ({ label: transport, value: transport })),
      'tcp',
    ) as BootstrapAnswers['transport'];
  }

  if (!answers.tooling) {
    answers.tooling = await prompt.select('Tooling preset', [
      { label: 'standard', value: 'standard' },
    ] as const, 'standard');
  }

  if (!answers.packageManager) {
    answers.packageManager = await prompt.select('Package manager', [
      { label: 'pnpm', value: 'pnpm' },
      { label: 'npm', value: 'npm' },
      { label: 'yarn', value: 'yarn' },
      { label: 'bun', value: 'bun' },
    ] as const, detectedPackageManager);
  }

  if (!hasOwnValue(answers, 'installDependencies')) {
    answers.installDependencies = await prompt.confirm('Install dependencies now', DEFAULT_INSTALL_DEPENDENCIES);
  }

  if (!hasOwnValue(answers, 'initializeGit')) {
    answers.initializeGit = await prompt.confirm('Initialize a git repository', DEFAULT_INITIALIZE_GIT);
  }

  return resolveBootstrapAnswers(answers, cwd, userAgent);
}

function assertValidProjectName(projectName: string): string {
  const trimmed = projectName.trim();

  if (trimmed.length === 0) {
    throw new Error('Project name is required.');
  }

  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new Error(`Invalid project name "${projectName}": must not contain path separators or traversal sequences.`);
  }

  return trimmed;
}

function parsePackageManager(value: string | undefined): PackageManager | undefined {
  if (!value) {
    return undefined;
  }

  if (value.startsWith('bun')) {
    return 'bun';
  }

  if (value.startsWith('pnpm')) {
    return 'pnpm';
  }

  if (value.startsWith('yarn')) {
    return 'yarn';
  }

  if (value.startsWith('npm')) {
    return 'npm';
  }

  return undefined;
}

function detectFromUserAgent(userAgent: string | undefined): PackageManager | undefined {
  if (!userAgent) {
    return undefined;
  }

  const candidate = userAgent.split(' ')[0];
  return parsePackageManager(candidate);
}

function detectFromDirectory(startDirectory: string): PackageManager | undefined {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    const packageJsonPath = join(currentDirectory, 'package.json');

    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        packageManager?: string;
      };
      const fromPackageManagerField = parsePackageManager(packageJson.packageManager);

      if (fromPackageManagerField) {
        return fromPackageManagerField;
      }
    }

    if (existsSync(join(currentDirectory, 'bun.lock')) || existsSync(join(currentDirectory, 'bun.lockb'))) {
      return 'bun';
    }

    if (existsSync(join(currentDirectory, 'pnpm-lock.yaml'))) {
      return 'pnpm';
    }

    if (existsSync(join(currentDirectory, 'yarn.lock'))) {
      return 'yarn';
    }

    if (existsSync(join(currentDirectory, 'package-lock.json'))) {
      return 'npm';
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return undefined;
    }

    currentDirectory = parentDirectory;
  }
}

/**
 * Detects the package manager that should back the generated starter.
 *
 * @param startDirectory Directory used for lockfile and manifest discovery.
 * @param userAgent Optional package-manager user agent from the caller.
 * @returns The detected package manager, or the repo default when no signal exists.
 */
export function detectPackageManager(
  startDirectory: string,
  userAgent?: string,
): PackageManager {
  return detectFromUserAgent(userAgent)
    ?? detectFromDirectory(startDirectory)
    ?? DEFAULT_PACKAGE_MANAGER;
}

/**
 * Resolves partial bootstrap selections onto the shared answer model.
 *
 * @param partial Partial bootstrap selections collected from flags or runtime callers.
 * @param cwd Working directory used for package-manager detection.
 * @param userAgent Optional package-manager user agent from the caller.
 * @returns Fully resolved bootstrap answers with defaults applied.
 */
export function resolveBootstrapAnswers(
  partial: Partial<BootstrapAnswers>,
  cwd: string,
  userAgent?: string,
): BootstrapAnswers {
  if (!partial.projectName) {
    throw new Error('Project name is required.');
  }

  const projectName = assertValidProjectName(partial.projectName);
  const schema = resolveBootstrapSchema(partial);

  return {
    initializeGit: partial.initializeGit ?? DEFAULT_INITIALIZE_GIT,
    installDependencies: partial.installDependencies ?? DEFAULT_INSTALL_DEPENDENCIES,
    packageManager: partial.packageManager ?? detectPackageManager(cwd, userAgent),
    ...schema,
    projectName,
    targetDirectory: partial.targetDirectory ?? `./${projectName}`,
  };
}

/**
 * Collects bootstrap answers through the interactive wizard when needed.
 *
 * @param partial Partial bootstrap selections collected from flags or runtime callers.
 * @param cwd Working directory used for package-manager detection.
 * @param userAgent Optional package-manager user agent from the caller.
 * @param options Runtime overrides for interactive prompting.
 * @returns Fully resolved bootstrap answers for scaffolding.
 */
export async function collectBootstrapAnswers(
  partial: Partial<BootstrapAnswers>,
  cwd: string,
  userAgent?: string,
  options: ResolveBootstrapAnswersOptions = {},
): Promise<BootstrapAnswers> {
  const interactive = options.interactive
    ?? (options.prompt !== undefined || Boolean(options.stdin?.isTTY ?? process.stdin.isTTY));

  if (!shouldPromptForAnswers(partial, interactive)) {
    return resolveBootstrapAnswers(partial, cwd, userAgent);
  }

  const prompt = options.prompt ?? createBootstrapPrompter();
  const isInteractiveShell = options.prompt === undefined;

  try {
    if (isInteractiveShell) {
      clack.intro('fluo new');
    }

    const answers = await resolveInteractiveBootstrapAnswers(partial, cwd, userAgent, prompt);

    if (isInteractiveShell) {
      clack.outro(resolveCompletionMessage(options.completionMessage, answers));
    }

    return answers;
  } finally {
    prompt.close?.();
  }
}
