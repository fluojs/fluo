import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('.', import.meta.url));
const worktree = fileURLToPath(new URL('../../../../', import.meta.url));
const receiptsRoot = join(worktree, '.omo/issue-3718-native');
await mkdir(receiptsRoot, { recursive: true });
const receipts = await mkdtemp(join(receiptsRoot, 'run-'));
const suffix = randomUUID().replaceAll('-', '');
const postgres = `fluo-3718-pg-${suffix}`;
const mongo = `fluo-3718-mongo-${suffix}`;
const database = `acceptance_${suffix}`;
const images = {
  postgres: 'postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685',
  mongo: 'mongo:8.0.20@sha256:098862b1339f031900ca66cf8fef799e616d6324fa41b9a263f2ec899552c1ef',
};
const created = [];
const streams = [];
const commands = [];
console.log(`RECEIPTS ${receipts}`);

async function command(binary, args, options = {}) {
  const child = spawn(binary, args, { cwd: fixture, ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  commands.push({ binary, args, code, output });
  if (code !== 0) throw new Error(`${binary} ${args.join(' ')} exited ${code}\n${output}`);
  return output.trim();
}

function attachAndStart(name) {
  // Starting with --attach subscribes to logs before mongod/postgres can emit
  // readiness, unlike a later probe loop or a guessed startup delay.
  const child = spawn('docker', ['start', '--attach', name], { stdio: ['ignore', 'pipe', 'pipe'] });
  const events = new EventEmitter();
  const stream = { child, name, output: '', closed: false };
  streams.push(stream);
  const receive = (chunk) => {
    stream.output += chunk;
    events.emit('output');
  };
  child.stdout.on('data', receive);
  child.stderr.on('data', receive);
  child.once('error', (error) => { events.emit('failure', error); });
  child.once('close', (code) => {
    stream.closed = true;
    events.emit('failure', new Error(`${name} exited ${code}`));
  });
  return {
    ready(pattern) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => finish(new Error(`${name} readiness deadline exceeded`)), 120_000);
        const inspect = () => {
          if (pattern.test(stream.output)) finish();
          else if (stream.closed) finish(new Error(`${name} exited before readiness`));
        };
        const finish = (error) => {
          clearTimeout(timeout);
          events.off('output', inspect);
          events.off('failure', finish);
          if (error) reject(error);
          else resolve();
        };
        events.on('output', inspect);
        events.on('failure', finish);
        inspect();
      });
    },
  };
}

let failure;
try {
  for (const image of Object.values(images)) {
    await command('docker', ['image', 'inspect', image, '--format', '{{json .RepoDigests}}']);
  }
  await command('docker', [
    'create', '--name', postgres, '--publish', '127.0.0.1::5432',
    '--tmpfs', '/var/lib/postgresql/data',
    '--env', 'POSTGRES_PASSWORD=fixture', '--env', `POSTGRES_DB=${database}`,
    images.postgres,
  ]);
  created.push(postgres);
  await command('docker', [
    'create', '--name', mongo, '--publish', '127.0.0.1::27017',
    '--tmpfs', '/data/db', '--tmpfs', '/data/configdb',
    images.mongo, 'mongod', '--replSet', 'rs0', '--bind_ip_all',
    '--setParameter', 'enableTestCommands=1',
  ]);
  created.push(mongo);
  const pgLogs = attachAndStart(postgres);
  const mongoLogs = attachAndStart(mongo);
  await Promise.all([
    // The init server only listens on a Unix socket. Match the final TCP server.
    pgLogs.ready(/listening on IPv4 address[\s\S]*database system is ready to accept connections/),
    mongoLogs.ready(/"msg":"Waiting for connections"/),
  ]);
  const primary = mongoLogs.ready(/Transition to primary complete; database writes are now permitted/);
  await Promise.all([
    primary,
    command('docker', [
      'exec', mongo, 'mongosh', '--quiet', '--eval',
      'const result = db.adminCommand({replSetInitiate:{_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]}}); if (result.ok !== 1) throw new Error(JSON.stringify(result));',
    ]),
  ]);
  const pgPort = (await command('docker', ['port', postgres, '5432/tcp'])).split(':').at(-1);
  const mongoPort = (await command('docker', ['port', mongo, '27017/tcp'])).split(':').at(-1);
  assert.match(pgPort, /^\d+$/);
  assert.match(mongoPort, /^\d+$/);
  console.log(`NATIVE_READY PostgreSQL=${pgPort} MongoDB=${mongoPort} database=${database}`);
  const output = await command(process.execPath, [
    '--test', '--test-concurrency=1', '--test-timeout=120000', '--test-reporter=tap', 'acceptance.ts',
  ], {
    env: {
      ...process.env,
      DATABASE_URL: `postgresql://postgres:fixture@127.0.0.1:${pgPort}/${database}`,
      MONGO_URL: `mongodb://127.0.0.1:${mongoPort}/${database}?replicaSet=rs0&directConnection=true`,
    },
  });
  console.log(output);
  console.log('NATIVE_ACCEPTANCE_PASS');
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  const cleanup = await Promise.allSettled(created.map((name) => command('docker', ['rm', '--force', '--volumes', name])));
  for (const stream of streams) {
    stream.child.kill('SIGTERM');
    await writeFile(join(receipts, `${stream.name}.log`), stream.output);
  }
  await writeFile(join(receipts, 'commands.json'), JSON.stringify(commands, null, 2));
  await writeFile(join(receipts, 'result.json'), JSON.stringify({
    success: !failure && cleanup.every((result) => result.status === 'fulfilled'),
    images, created, database,
    failure: failure instanceof Error ? failure.stack : failure,
    cleanup: cleanup.map((result) => result.status),
  }, null, 2));
  if (cleanup.some((result) => result.status === 'rejected')) {
    console.error('NATIVE_CLEANUP_FAILED', cleanup);
    process.exitCode = 1;
  }
}
if (failure) process.exitCode = 1;
