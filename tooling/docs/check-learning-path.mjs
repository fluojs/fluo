import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sandbox = await mkdtemp(path.join(os.tmpdir(), 'fluo-learning-'));
const appDir = path.join(sandbox, 'learning-app');
const stages = [
  '01-modules', '02-controllers', '03-providers',
  '04-validation', '05-serialization', '06-errors',
];

async function command(args, cwd) {
  const child = spawn('pnpm', args, {
    cwd,
    env: { ...process.env, CI: 'true', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    signal: AbortSignal.timeout(180_000),
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  const [code] = await once(child, 'close');
  assert.equal(code, 0, `pnpm ${args.join(' ')} failed`);
}

async function probe(stage) {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: appDir,
    env: { ...process.env, PORT: '0', NODE_ENV: 'production', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  let output = '';
  try {
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Listener deadline: ${output}`)), 20_000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Listener exited ${code}: ${output}`));
      });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/Listening on http:\/\/[^ \n]+:(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(`http://localhost:${match[1]}`);
        }
      });
    });
    const request = (endpoint, init = {}) =>
      fetch(`${origin}${endpoint}`, { ...init, signal: AbortSignal.timeout(10_000) });
    for (const endpoint of ['/health', '/ready', '/greeting']) {
      assert.equal((await request(endpoint)).status, 200, endpoint);
    }
    const list = await request('/posts');
    assert.equal(list.status, stage === '01-modules' ? 404 : 200);
    if (stage !== '01-modules') {
      assert.deepEqual(await list.json(), [{ id: '1', title: 'Hello Fluo', content: 'First post' }]);
    }
    if (stages.indexOf(stage) >= 3) {
      const create = await request('/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Second post', content: 'Created through HTTP' }),
      });
      assert.equal(create.status, 201);
      assert.deepEqual(await create.json(), {
        id: '2', title: 'Second post', content: 'Created through HTTP',
      });
      const invalid = await request('/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Hi', content: 'Rejected' }),
      });
      assert.equal(invalid.status, 400);
      assert.equal((await (await request('/posts')).json()).length, 2);
    }
    if (stage === '06-errors') {
      assert.equal((await request('/posts/1')).status, 200);
      assert.equal((await request('/posts/missing')).status, 404);
    }
    console.log(`CHECKPOINT_PASS ${stage}`);
  } finally {
    child.kill('SIGINT');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    await closed;
    clearTimeout(timer);
  }
}

try {
  await command(['dlx', '@fluojs/cli@3.0.2', 'new', 'learning-app',
    '--shape', 'application', '--transport', 'http', '--runtime', 'node',
    '--platform', 'fastify', '--package-manager', 'pnpm'], sandbox);
  await command(['add', '@fluojs/serialization'], appDir);
  const appPath = path.join(appDir, 'src/app.ts');
  const appSource = await readFile(appPath, 'utf8');
  assert.ok(appSource.includes('imports: ['), 'Generated root module structure changed');
  await writeFile(appPath, `import { PostsModule } from './posts/posts.module';\n${appSource.replace(
    'imports: [', 'imports: [PostsModule,',
  )}`);
  for (const stage of stages) {
    const destination = path.join(appDir, 'src/posts');
    await rm(destination, { recursive: true, force: true });
    await cp(path.join(root, 'tooling/docs/fixtures/learning-path', stage), destination, { recursive: true });
    if (stage === '06-errors') {
      const lesson = await readFile(path.join(root, 'apps/docs/content/docs/overview/testing.mdx'), 'utf8');
      const test = lesson.match(/```ts title="test\/posts.e2e.test.ts"\n([\s\S]*?)\n```/);
      assert.ok(test, 'Testing chapter must ship its executable test');
      await writeFile(path.join(appDir, 'test/posts.e2e.test.ts'), test[1]);
    }
    await command(['test'], appDir);
    await command(['exec', 'tsc', '--noEmit'], appDir);
    await command(['build'], appDir);
    await probe(stage);
  }
  console.log(`LEARNING_PATH_PASS ${sandbox}`);
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
