import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultSandboxRoot = resolve(join(tmpdir(), 'konekti-cli-sandbox'));
const sandboxMetadataFileName = '.konekti-cli-sandbox.json';
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, '..');
const repoRoot = resolve(packageRoot, '..', '..');
function isPathInsideDirectory(parentDirectory, candidatePath) {
  const resolvedParentDirectory = resolve(parentDirectory);
  const resolvedCandidatePath = resolve(candidatePath);

  return resolvedCandidatePath === resolvedParentDirectory || resolvedCandidatePath.startsWith(resolvedParentDirectory + sep);
}

function resolveSandboxRoot(env) {
  const requestedSandboxRoot = env.KONEKTI_CLI_SANDBOX_ROOT ? resolve(env.KONEKTI_CLI_SANDBOX_ROOT) : undefined;

  if (requestedSandboxRoot && isPathInsideDirectory(repoRoot, requestedSandboxRoot)) {
    return {
      sandboxRoot: defaultSandboxRoot,
      warning: `Ignoring KONEKTI_CLI_SANDBOX_ROOT=${requestedSandboxRoot} because sandbox projects must live outside the repo workspace.`,
    };
  }

  return {
    sandboxRoot: requestedSandboxRoot ?? defaultSandboxRoot,
  };
}

const { sandboxRoot, warning: sandboxRootWarning } = resolveSandboxRoot(process.env);
const defaultProjectName = 'starter-app';

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
  void projectName;
  return sandboxRoot;
}

function sandboxMetadataPath(projectDirectory) {
  return join(projectDirectory, sandboxMetadataFileName);
}

function isLegacySandboxDirectory(projectDirectory) {
  return existsSync(join(projectDirectory, defaultProjectName, 'package.json'));
}

function isManagedSandboxDirectory(projectDirectory) {
  return existsSync(sandboxMetadataPath(projectDirectory));
}

function assertSafeToResetSandbox(projectDirectory) {
  const resolvedProjectDirectory = resolve(projectDirectory);

  if (!existsSync(resolvedProjectDirectory)) {
    return;
  }

  if (isManagedSandboxDirectory(resolvedProjectDirectory) || isLegacySandboxDirectory(resolvedProjectDirectory)) {
    return;
  }

  if (readdirSync(resolvedProjectDirectory).length === 0) {
    return;
  }

  throw new Error(
    `Refusing to reset a non-sandbox directory at ${resolvedProjectDirectory}. Choose an empty path or a dedicated KONEKTI_CLI_SANDBOX_ROOT.`,
  );
}

function writeSandboxMetadata(projectDirectory, projectName) {
  writeFileSync(
    sandboxMetadataPath(projectDirectory),
    JSON.stringify(
      {
        createdBy: '@konekti/cli local sandbox',
        projectName,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}

function assertInsideSandboxRoot(projectDirectory) {
  const resolvedSandboxRoot = resolve(sandboxRoot);
  const resolvedProjectDirectory = resolve(projectDirectory);

  if (!isPathInsideDirectory(resolvedSandboxRoot, resolvedProjectDirectory)) {
    throw new Error(`Refusing to operate outside sandbox root: ${resolvedProjectDirectory}`);
  }
}

function logSandboxRoot() {
  if (sandboxRootWarning) {
    log(sandboxRootWarning);
  }

  log(`Using sandbox root ${sandboxRoot}`);
}

function cleanSandbox(projectDirectory) {
  assertInsideSandboxRoot(projectDirectory);
  assertSafeToResetSandbox(projectDirectory);
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

  writeSandboxMetadata(projectDirectory, projectName);
  log(`Sandbox project is ready at ${projectDirectory}`);
  return projectDirectory;
}

function verifySandboxProject(projectName) {
  const projectDirectory = resolveProjectDirectory(projectName);
  verifySandboxExists(projectDirectory);

  if (!existsSync(join(projectDirectory, 'src', 'app.e2e.test.ts'))) {
    throw new Error('Expected the starter scaffold to include src/app.e2e.test.ts.');
  }

  log('Running generated project checks');
  run('pnpm', ['typecheck'], projectDirectory);
  run('pnpm', ['build'], projectDirectory);
  run('pnpm', ['test'], projectDirectory);

  log('Running the installed CLI inside the sandbox project');
  run('pnpm', ['exec', 'konekti', 'g', 'repo', 'User'], projectDirectory);

  if (!existsSync(join(projectDirectory, 'src', 'users', 'user.repo.ts'))) {
    throw new Error('Expected the installed CLI to generate src/users/user.repo.ts.');
  }

  if (!existsSync(join(projectDirectory, 'src', 'users', 'user.repo.slice.test.ts'))) {
    throw new Error('Expected the installed CLI to generate src/users/user.repo.slice.test.ts.');
  }

  log('Re-running typecheck and test after generator output');
  run('pnpm', ['typecheck'], projectDirectory);
  run('pnpm', ['test'], projectDirectory);

  log('Sandbox verification passed');
}

function printUsage() {
  process.stdout.write(
    [
      'Usage: node ./scripts/local-test-env.mjs <create|verify|test|clean> [project-name]',
      'Defaults project-name to starter-app and uses the sandbox root itself as the generated app directory.',
      'Set KONEKTI_CLI_SANDBOX_ROOT to override the sandbox root outside the repo workspace.',
    ].join('\n') + '\n',
  );
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const projectName = resolveProjectName(rest);
  const projectDirectory = resolveProjectDirectory(projectName);

  switch (command) {
    case 'create':
      logSandboxRoot();
      await createSandboxProject(projectName);
      break;
    case 'verify':
      logSandboxRoot();
      verifySandboxProject(projectName);
      break;
    case 'test':
      logSandboxRoot();
      await createSandboxProject(projectName);
      verifySandboxProject(projectName);
      break;
    case 'clean':
      logSandboxRoot();
      cleanSandbox(projectDirectory);
      log(`Removed ${projectDirectory}`);
      break;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

await main();
