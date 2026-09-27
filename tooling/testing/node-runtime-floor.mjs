#!/usr/bin/env node
// Exact-Node 24.0.0 runtime-only floor verification.
//
// Bundle mode (compiler-capable Node >= 24.11.0):
//   node tooling/testing/node-runtime-floor.mjs --bundle [--dist] --output <dir>
// Execute mode (exact Node 24.0.0, or any Node >= 24.0.0 with --self-test):
//   node tooling/testing/node-runtime-floor.mjs <dir>/runtime-floor-exercise.mjs [--self-test]
//
// The bundle imports the real public runtime entries and a decorated fixture
// module through the workspace compiler toolchain. The execute mode loads no
// Babel and no workspace dependencies: the bundle is self-contained.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RUNTIME_FLOOR_PLAN = Object.freeze({
  runtimeNodeVersion: '24.0.0',
  publicEntryImports: Object.freeze([
    '@fluojs/core/metadata-preload',
    '@fluojs/config',
    '@fluojs/http',
    '@fluojs/platform-nodejs',
    '@fluojs/runtime',
  ]),
  behaviors: Object.freeze([
    'config-in-memory-load',
    'http-listener-greeting-dispatch',
    'http-listener-health-readiness',
    'graceful-application-close',
  ]),
});

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const EXERCISE_ENTRY = join(REPO_ROOT, 'tooling/testing/runtime-floor/exercise.ts');
const BUNDLE_FILE_NAME = 'runtime-floor-exercise.mjs';

function parseNodeVersion(version) {
  const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10));
  return { major, minor, patch };
}

function isNodeVersionAtLeast(current, minimum) {
  const left = parseNodeVersion(current);
  const right = parseNodeVersion(minimum);
  if (left.major !== right.major) return left.major > right.major;
  if (left.minor !== right.minor) return left.minor > right.minor;
  return left.patch >= right.patch;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseCompilerFloorRequirement() {
  return 'Node >=24.11.0 <27 (the Babel 8 compiler toolchain floor)';
}

function sourceAliases() {
  const packageEntry = (packageName, fileName) => join(REPO_ROOT, 'packages', packageName, 'src', fileName);
  return [
    { find: /^@fluojs\/core\/metadata-preload$/, replacement: packageEntry('core', 'metadata-preload.ts') },
    { find: /^@fluojs\/core$/, replacement: packageEntry('core', 'index.ts') },
    { find: /^@fluojs\/config$/, replacement: packageEntry('config', 'index.ts') },
    { find: /^@fluojs\/di$/, replacement: packageEntry('di', 'index.ts') },
    { find: /^@fluojs\/http$/, replacement: packageEntry('http', 'index.ts') },
    { find: /^@fluojs\/validation$/, replacement: packageEntry('validation', 'index.ts') },
    { find: /^@fluojs\/runtime$/, replacement: packageEntry('runtime', 'index.ts') },
    { find: /^@fluojs\/platform-nodejs$/, replacement: packageEntry('platform-nodejs', 'index.ts') },
  ];
}

function distAliases() {
  const packageEntry = (packageName, fileName) => join(REPO_ROOT, 'packages', packageName, 'dist', fileName);
  return [
    { find: /^@fluojs\/core\/metadata-preload$/, replacement: packageEntry('core', 'metadata-preload.js') },
    { find: /^@fluojs\/core$/, replacement: packageEntry('core', 'index.js') },
    { find: /^@fluojs\/config$/, replacement: packageEntry('config', 'index.js') },
    { find: /^@fluojs\/di$/, replacement: packageEntry('di', 'index.js') },
    { find: /^@fluojs\/http$/, replacement: packageEntry('http', 'index.js') },
    { find: /^@fluojs\/validation$/, replacement: packageEntry('validation', 'index.js') },
    { find: /^@fluojs\/runtime$/, replacement: packageEntry('runtime', 'index.js') },
    { find: /^@fluojs\/platform-nodejs$/, replacement: packageEntry('platform-nodejs', 'index.js') },
  ];
}

async function bundle(outputDirectory, useDist) {
  const current = process.versions.node;
  const compilerCapable = isNodeVersionAtLeast(current, '24.11.0')
    && parseNodeVersion(current).major < 27;
  if (!compilerCapable) {
    fail(`Bundling the runtime floor exercise requires ${parseCompilerFloorRequirement()}; current Node is ${current}.`);
  }

  const [{ build }, babel] = await Promise.all([import('vite'), import('@babel/core')]);
  const aliases = useDist ? distAliases() : sourceAliases();
  const fixtureRoot = join(REPO_ROOT, 'tooling/testing/runtime-floor');
  const babelPlugins = [['@babel/plugin-proposal-decorators', { version: '2023-11' }]];
  const babelPresets = ['@babel/preset-typescript'];
  const babelPlugin = {
    name: 'fluo-runtime-floor-decorators',
    enforce: 'pre',
    async transform(code, id) {
      const normalized = id.split('?', 1)[0].replaceAll('\\', '/');
      if (!/\.tsx?$/u.test(normalized) || /\.d\.ts$/u.test(normalized)) {
        return null;
      }
      const withinPackages = normalized.startsWith(`${REPO_ROOT.replaceAll('\\', '/')}/packages/`) && !useDist;
      const withinFixture = normalized.startsWith(fixtureRoot.replaceAll('\\', '/'));
      if (!withinPackages && !withinFixture) {
        return null;
      }

      const result = await babel.transformAsync(code, {
        babelrc: false,
        configFile: false,
        filename: normalized,
        plugins: babelPlugins,
        presets: babelPresets,
        sourceMaps: false,
      });

      return result?.code ? { code: result.code, map: null } : null;
    },
  };

  mkdirSync(outputDirectory, { recursive: true });
  await build({
    configFile: false,
    root: REPO_ROOT,
    logLevel: 'warn',
    resolve: { alias: aliases },
    plugins: [babelPlugin],
    ssr: { noExternal: true },
    build: {
      ssr: true,
      outDir: outputDirectory,
      emptyOutDir: true,
      write: true,
      minify: false,
      target: 'node24',
      rolldownOptions: {
        input: EXERCISE_ENTRY,
        output: { entryFileNames: BUNDLE_FILE_NAME, format: 'esm' },
      },
    },
  });

  const bundlePath = join(outputDirectory, BUNDLE_FILE_NAME);
  if (!existsSync(bundlePath)) {
    fail(`Expected the Vite bundle at ${bundlePath}.`);
  }

  writeFileSync(
    join(outputDirectory, 'manifest.json'),
    `${JSON.stringify({
      plan: RUNTIME_FLOOR_PLAN,
      distMode: useDist,
      bundledWithNode: process.versions.node,
      exerciseEntry: 'tooling/testing/runtime-floor/exercise.ts',
    }, null, 2)}\n`,
  );
  process.stdout.write(`${bundlePath}\n`);
}

async function execute(bundlePath, selfTest) {
  const current = process.versions.node;
  if (!selfTest && current !== RUNTIME_FLOOR_PLAN.runtimeNodeVersion) {
    fail(
      `The runtime-only floor lane requires exactly Node ${RUNTIME_FLOOR_PLAN.runtimeNodeVersion}; ` +
        `current Node is ${current}. Build the exercise under a supported compiler Node, then execute it on 24.0.0.`,
    );
  }
  if (selfTest && !isNodeVersionAtLeast(current, '24.0.0')) {
    fail(`The runtime floor exercise requires Node >=24.0.0; current Node is ${current}.`);
  }

  if (!existsSync(bundlePath)) {
    fail(`Runtime floor exercise bundle not found at ${bundlePath}.`);
  }

  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (specifier.startsWith('@babel/') || resolved.url.includes('/node_modules/@babel/')) {
        fail('ERR_RUNTIME_FLOOR_COMPILER_IMPORT: the runtime exercise must not load Babel.');
      }
      return resolved;
    },
  });

  const exercise = await import(pathToFileURL(resolve(bundlePath)).href);
  if (typeof exercise.runRuntimeFloorExercises !== 'function') {
    fail(`The bundle at ${bundlePath} does not export runRuntimeFloorExercises().`);
  }

  const behaviors = await exercise.runRuntimeFloorExercises();
  const passed = behaviors.length === RUNTIME_FLOOR_PLAN.behaviors.length
    && RUNTIME_FLOOR_PLAN.behaviors.every((name) =>
      behaviors.some((behavior) => behavior.name === name && behavior.passed === true));
  process.stdout.write(`${JSON.stringify({ nodeVersion: current, passed, behaviors })}\n`);
  process.exit(passed ? 0 : 1);
}

const arguments_ = process.argv.slice(2);
const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly && arguments_[0] === '--bundle') {
  const useDist = arguments_.includes('--dist');
  const outputIndex = arguments_.indexOf('--output');
  const outputDirectory = outputIndex >= 0 ? arguments_[outputIndex + 1] : mkdtempSync(join(REPO_ROOT, '.omo/tmp/runtime-floor-'));
  if (!outputDirectory) {
    fail('--bundle requires --output <directory>.');
  }
  await bundle(outputDirectory, useDist);
} else if (invokedDirectly && arguments_[0] && !arguments_[0].startsWith('--')) {
  await execute(arguments_[0], arguments_.includes('--self-test'));
} else if (invokedDirectly) {
  fail(
    'Usage: node tooling/testing/node-runtime-floor.mjs --bundle [--dist] --output <dir>\n' +
      '       node tooling/testing/node-runtime-floor.mjs <dir>/runtime-floor-exercise.mjs [--self-test]',
  );
}
