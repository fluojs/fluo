import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, '..');
const repoRoot = resolve(packageRoot, '..', '..');
const sandboxRoot = resolve(process.env.KONEKTI_CLI_SANDBOX_ROOT ?? join(tmpdir(), 'konekti-cli-sandbox'));
const defaultProjectName = 'starter-app';
const defaultProjectDirectory = join(sandboxRoot, defaultProjectName);

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}.`);
  }
}

function log(message) {
  process.stdout.write(`[cli sandbox] ${message}\n`);
}

function resolveProjectName(argv) {
  const projectName = argv[0] || defaultProjectName;

  if (projectName.includes('/') || projectName.includes('\\') || projectName === '.' || projectName === '..') {
    throw new Error('Project name must be a simple directory name without path separators.');
  }

  return projectName;
}

function resolveProjectDirectory(projectName) {
  return projectName === defaultProjectName ? defaultProjectDirectory : join(sandboxRoot, projectName);
}

function assertInsideSandboxRoot(projectDirectory) {
  const resolvedSandboxRoot = resolve(sandboxRoot);
  const resolvedProjectDirectory = resolve(projectDirectory);

  if (
    resolvedProjectDirectory !== resolvedSandboxRoot &&
    !resolvedProjectDirectory.startsWith(resolvedSandboxRoot + sep) &&
    !(isAbsolute(resolvedProjectDirectory) && resolvedProjectDirectory.startsWith(resolvedSandboxRoot + '/'))
  ) {
    throw new Error(`Refusing to operate outside sandbox root: ${resolvedProjectDirectory}`);
  }
}

function cleanSandbox(projectDirectory) {
  assertInsideSandboxRoot(projectDirectory);
  rmSync(projectDirectory, { force: true, recursive: true });
}

function verifySandboxExists(projectDirectory) {
  if (!existsSync(join(projectDirectory, 'package.json'))) {
    throw new Error(
      `Sandbox project not found at ${projectDirectory}. Run \`pnpm sandbox:create\` first or use \`pnpm sandbox:test\`.`,
    );
  }
}

async function loadRunCli() {
  log('Building @konekti/cli dist for the local harness');
  run('pnpm', ['build'], packageRoot);

  const cliModuleUrl = pathToFileURL(join(packageRoot, 'dist', 'cli.js')).href;
  const cliModule = await import(cliModuleUrl);

  if (typeof cliModule.runCli !== 'function') {
    throw new Error('Unable to load runCli from packages/cli/dist/cli.js.');
  }

  return cliModule.runCli;
}

async function createSandboxProject(projectName) {
  const projectDirectory = resolveProjectDirectory(projectName);
  const runCli = await loadRunCli();

  log(`Refreshing sandbox at ${projectDirectory}`);
  cleanSandbox(projectDirectory);

  const exitCode = await runCli(
    [
      'new',
      projectName,
      '--package-manager',
      'pnpm',
      '--target-directory',
      projectDirectory,
    ],
    {
      cwd: sandboxRoot,
      dependencySource: 'local',
      repoRoot,
    },
  );

  if (exitCode !== 0) {
    throw new Error(`runCli returned a non-zero exit code: ${exitCode}.`);
  }

  log(`Sandbox project is ready at ${projectDirectory}`);
  return projectDirectory;
}

function verifySandboxProject(projectName) {
  const projectDirectory = resolveProjectDirectory(projectName);
  verifySandboxExists(projectDirectory);

  log('Running generated project checks');
  run('pnpm', ['typecheck'], projectDirectory);
  run('pnpm', ['build'], projectDirectory);
  run('pnpm', ['test'], projectDirectory);

  log('Running the installed CLI inside the sandbox project');
  run('pnpm', ['exec', 'konekti', 'g', 'repo', 'User'], projectDirectory);

  if (!existsSync(join(projectDirectory, 'src', 'users', 'user.repo.ts'))) {
    throw new Error('Expected the installed CLI to generate src/users/user.repo.ts.');
  }

  log('Re-running typecheck after generator output');
  run('pnpm', ['typecheck'], projectDirectory);

  log('Sandbox verification passed');
}

function printUsage() {
  process.stdout.write(
    [
      'Usage: node ./scripts/local-test-env.mjs <create|verify|test|clean> [project-name]',
      'Defaults project-name to starter-app and writes the sandbox under your system temp directory.',
      'Set KONEKTI_CLI_SANDBOX_ROOT to override the sandbox root.',
    ].join('\n') + '\n',
  );
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const projectName = resolveProjectName(rest);
  const projectDirectory = resolveProjectDirectory(projectName);

  switch (command) {
    case 'create':
      await createSandboxProject(projectName);
      break;
    case 'verify':
      verifySandboxProject(projectName);
      break;
    case 'test':
      await createSandboxProject(projectName);
      verifySandboxProject(projectName);
      break;
    case 'clean':
      cleanSandbox(projectDirectory);
      log(`Removed ${projectDirectory}`);
      break;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

await main();
