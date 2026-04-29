import autocannon, { type Result } from 'autocannon';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';

import { printReport, type ScenarioResult, type TargetResult } from './report';

const FLUO_FASTIFY_PORT = 3001;
const NESTJS_PORT = 3002;
const FLUO_BUN_PORT = 3003;
const NESTJS_EXPRESS_PORT = 3004;
const FLUO_EXPRESS_PORT = 3005;
const WDIR = process.cwd();
const FLUO_BUN_BUILD_DIR = join(WDIR, 'dist/fluo-bun');

type TargetName = 'nestjs-fastify' | 'fluo-fastify' | 'fluo-bun' | 'nestjs-express' | 'fluo-express';

interface TargetConfig {
  name: TargetName;
  label: string;
  port: number;
  command: string;
  args: string[];
}

const TARGETS: TargetConfig[] = [
  {
    name: 'nestjs-fastify',
    label: 'Nest+Fastify',
    port: NESTJS_PORT,
    command: 'ts-node',
    args: ['--transpile-only', '--project', 'nestjs/tsconfig.json', 'src/nestjs/server.ts'],
  },
  {
    name: 'nestjs-express',
    label: 'Nest+Express',
    port: NESTJS_EXPRESS_PORT,
    command: 'ts-node',
    args: ['--transpile-only', '--project', 'nestjs/tsconfig.json', 'src/nestjs-express/server.ts'],
  },
  {
    name: 'fluo-fastify',
    label: 'fluo+Fastify',
    port: FLUO_FASTIFY_PORT,
    command: 'tsx',
    args: ['src/fluo/server.ts'],
  },
  {
    name: 'fluo-express',
    label: 'fluo+Express',
    port: FLUO_EXPRESS_PORT,
    command: 'tsx',
    args: ['src/fluo-express/server.ts'],
  },
  {
    name: 'fluo-bun',
    label: 'fluo+Bun',
    port: FLUO_BUN_PORT,
    command: 'bun',
    args: ['run', 'dist/fluo-bun/server.js'],
  },
];

const USER_RESPONSE = JSON.stringify({ id: '1', name: 'Alice', email: 'alice@example.com' });

function routePaths(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `/di-chain/r${String(index + 1).padStart(2, '0')}/1`);
}

const SCENARIOS = [
  {
    name: 'baseline',
    description: 'Pure routing — no DI',
    path: '/baseline',
    expectedBodies: [JSON.stringify({ ok: true })],
  },
  {
    name: 'di-chain',
    description: 'Path DTO + 3-level DI chain  (Controller → Service → Repository)',
    path: '/di-chain/1',
    expectedBodies: [USER_RESPONSE],
  },
  {
    name: 'di-chain-random-3',
    description: 'Random 3-route path DTO + 3-level DI chain',
    paths: routePaths(3),
    expectedBodies: [USER_RESPONSE],
  },
  {
    name: 'di-chain-random-5',
    description: 'Random 5-route path DTO + 3-level DI chain',
    paths: routePaths(5),
    expectedBodies: [USER_RESPONSE],
  },
  {
    name: 'di-chain-random-20',
    description: 'Random 20-route path DTO + 3-level DI chain',
    paths: routePaths(20),
    expectedBodies: [USER_RESPONSE],
  },
] as const;

const WARMUP_SEC = 10;
const MEASURE_SEC = 40;
const CONNECTIONS = 100;

function waitForPort(port: number, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = (): void => {
      const sock = createConnection({ port, host: '127.0.0.1' });
      sock.on('connect', () => { sock.destroy(); resolve(); });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`port ${port} not ready within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 300);
        }
      });
    };
    attempt();
  });
}

function assertCleanResult(label: string, result: Result): void {
  const failures = [
    ['errors', result.errors],
    ['timeouts', result.timeouts],
    ['non2xx', result.non2xx],
    ['mismatches', result.mismatches],
  ].filter(([, count]) => count !== 0);

  if (failures.length > 0) {
    const details = failures.map(([name, count]) => `${name}=${count}`).join(', ');
    throw new Error(`${label} returned invalid benchmark traffic: ${details}`);
  }
}

function randomPath(paths: readonly string[]): string {
  return paths[Math.floor(Math.random() * paths.length)] ?? paths[0] ?? '/';
}

function shoot(
  url: string,
  duration: number,
  expectedBodies: readonly string[],
  label: string,
  paths?: readonly string[],
): Promise<Result> {
  return new Promise((resolve, reject) => {
    autocannon({
      url,
      connections: CONNECTIONS,
      duration,
      verifyBody: (body) => expectedBodies.includes(String(body)),
      bailout: 1,
      ...(paths
        ? {
            requests: [{
              setupRequest(request) {
                request.path = randomPath(paths);
                return request;
              },
            }],
          }
        : {}),
    }, (err, result) => {
      if (err) {
        reject(err);
        return;
      }

      assertCleanResult(label, result!);
      resolve(result!);
    });
  });
}

async function measure(
  label: string,
  url: string,
  expectedBodies: readonly string[],
  paths?: readonly string[],
): Promise<Result> {
  process.stdout.write(`  measuring ${label.padEnd(6)} (${MEASURE_SEC}s)...`);
  const result = await shoot(url, MEASURE_SEC, expectedBodies, label, paths);
  process.stdout.write(' done\n');
  return result;
}

async function runScenario(s: (typeof SCENARIOS)[number], index: number): Promise<ScenarioResult> {
  const scenarioTargets = rotationFor(index).map((target) => ({
    target,
    url: `http://127.0.0.1:${target.port}${'path' in s ? s.path : ''}`,
  }));

  process.stdout.write(`  [${s.name}] warm-up (${WARMUP_SEC}s)...`);
  await Promise.all(scenarioTargets.map(({ target, url }) => (
    shoot(url, WARMUP_SEC, s.expectedBodies, `${s.name}/${target.label} warm-up`, 'paths' in s ? s.paths : undefined)
  )));
  process.stdout.write(' done\n');

  const measured: TargetResult[] = [];
  for (const { target, url } of scenarioTargets) {
    measured.push({
      label: target.label,
      result: await measure(target.label, url, s.expectedBodies, 'paths' in s ? s.paths : undefined),
    });
  }

  const targets = TARGETS.map((target) => {
    const result = measured.find((item) => item.label === target.label);
    if (!result) {
      throw new Error(`missing result for ${target.label}`);
    }
    return result;
  });

  return { name: s.name, description: s.description, targets };
}

function rotationFor(index: number): TargetConfig[] {
  const offset = index % TARGETS.length;
  return [...TARGETS.slice(offset), ...TARGETS.slice(0, offset)];
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: WDIR,
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} failed with ${signal ?? `exit code ${code}`}`));
    });
  });
}

async function buildBunTarget(): Promise<void> {
  await rm(FLUO_BUN_BUILD_DIR, { force: true, recursive: true });
  await runCommand('tsc', [
    'src/fluo-bun/server.ts',
    '--target', 'ES2022',
    '--module', 'ESNext',
    '--moduleResolution', 'Bundler',
    '--strict',
    '--skipLibCheck',
    '--outDir', 'dist/fluo-bun',
  ]);
}

async function main(): Promise<void> {
  await buildBunTarget();

  const processes = TARGETS.map((target) => {
    const child = spawn(target.command, target.args, {
      cwd: WDIR,
      env: { ...process.env, PORT: String(target.port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[${target.name}] ${String(d)}`));
    return child;
  });

  const cleanup = (): void => {
    for (const child of processes) {
      child.kill();
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });

  try {
    console.log('\nWaiting for servers...');
    await Promise.all(TARGETS.map((target) => waitForPort(target.port)));
    console.log('All servers ready\n');

    const results: ScenarioResult[] = [];
    for (const [index, s] of SCENARIOS.entries()) {
      console.log(`Scenario: ${s.name}`);
      results.push(await runScenario(s, index));
    }

    printReport(results);
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
