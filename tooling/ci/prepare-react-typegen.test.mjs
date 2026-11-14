import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const consumer = 'examples/react-vite-ssr';
const outputs = ['src/generated/react-pages.ts', 'tests/typegen-fixture/generated/react-pages.ts'];
const cli = join(repository, 'packages/cli/bin/fluo.mjs');

function fixture(t) {
  mkdirSync(join(repository, '.worktrees'), { recursive: true });
  const root = mkdtempSync(join(repository, '.worktrees/typegen-4093-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, consumer);
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  put('.gitignore', readFileSync(join(repository, '.gitignore')));
  put('package.json', '{"type":"module"}');
  put(`${consumer}/package.json`, '{"type":"module"}');
  const application = [
    "import { defineModule } from '@fluojs/runtime';",
    "import { Path, ReactModule, Router } from '@fluojs/react';",
    "@Router('/products') class ProductRouter { @Path('/:id') show(): void {} }",
    'export class AppModule {}',
    'export const applicationOptions = {};',
    'defineModule(AppModule, { imports: [ReactModule.forRoot({ controllers: [ProductRouter] })] });',
  ].join('\n');
  put(`${consumer}/src/app.ts`, application);
  put(`${consumer}/src/input-a.ts`, 'export const first = 1;\n');
  put(`${consumer}/src/input-b.ts`, 'export type Second = { value: string };\n');
  put(`${consumer}/tsconfig.json`, JSON.stringify({
    extends: join(repository, 'examples/react-vite-ssr/tsconfig.json'),
    include: ['src/*.ts'], exclude: ['node_modules'],
  }));
  put(`${consumer}/tests/typegen-fixture/app.module.ts`, application);
  put(`${consumer}/tests/typegen-fixture/tsconfig.json`, JSON.stringify({
    extends: '../../tsconfig.json', include: ['*.ts', '../../src/input-*.ts'], exclude: ['node_modules'],
  }));
  symlinkSync(join(repository, 'examples/react-vite-ssr/node_modules'), join(cwd, 'node_modules'), 'dir');
  mkdirSync(join(root, 'packages'), { recursive: true });
  symlinkSync(join(repository, 'packages/cli'), join(root, 'packages/cli'), 'dir');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  const typegen = (index, check = false) => {
    const args = ['typegen', index === 0 ? 'src/app.ts' : 'tests/typegen-fixture/app.module.ts',
      '--export', 'AppModule', ...(index === 0 ? ['--options', 'applicationOptions'] : []),
      '--tsconfig', index === 0 ? 'tsconfig.json' : 'tests/typegen-fixture/tsconfig.json',
      '--output', outputs[index], ...(check ? ['--check'] : [])];
    return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  };
  const generate = (check = false) => {
    for (const index of outputs.keys()) {
      const result = typegen(index, check);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
  };
  const prepare = () => spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { prepareReactTypegen } from ${JSON.stringify(new URL('./prepare-react-typegen.mjs', import.meta.url).href)};
process.exitCode = prepareReactTypegen(${JSON.stringify(root)});`], { cwd: root, encoding: 'utf8' });
  const commit = (message) => { git('add', '.'); git('commit', '-qm', message); };
  return { root, cwd, put, git, generate, typegen, prepare, commit };
}

test('typegen: independent compiler input branches -> merge without generated conflicts or committed artifacts', (t) => {
  const f = fixture(t);
  f.generate();
  f.commit('common inputs');
  const base = f.git('rev-parse', 'HEAD');
  f.git('switch', '-qc', 'first', base);
  f.put(`${consumer}/src/input-a.ts`, 'export const first = 2;\n');
  f.generate();
  f.commit('first input');
  f.git('switch', '-qc', 'second', base);
  f.put(`${consumer}/src/input-b.ts`, 'export type Second = { value: number };\n');
  f.generate();
  f.commit('second input');
  f.git('switch', '-q', 'main');
  f.git('merge', '--no-ff', '-qm', 'merge first', 'first');

  const merge = spawnSync('git', ['merge', '--no-ff', '-m', 'merge second', 'second'],
    { cwd: f.root, encoding: 'utf8' });

  assert.equal(merge.status, 0, merge.stdout + merge.stderr);
  assert.equal(f.git('ls-files', '--', ...outputs.map((path) => `${consumer}/${path}`)), '');
  assert.equal(f.git('log', '--format=', '--name-only', '--', ...outputs.map((path) => `${consumer}/${path}`)), '');
  f.generate();
  f.generate(true);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('prepare: clean checkout without artifacts -> generates both real targets without dirtying source', (t) => {
  const f = fixture(t);
  f.commit('clean consumer');
  for (const index of outputs.keys()) assert.equal(f.typegen(index, true).status, 2);

  const result = f.prepare();

  assert.equal(result.status, 0, result.stdout + result.stderr);
  f.generate(true);
  const bytes = outputs.map((path) => readFileSync(join(f.cwd, path), 'utf8'));
  assert.ok(bytes.every((text) => text.includes('Artifact version: 2.')));
  assert.equal(f.git('status', '--porcelain'), '');
  const again = f.prepare();
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.deepEqual(outputs.map((path) => readFileSync(join(f.cwd, path), 'utf8')), bytes);
});

for (const [name, path, replacement] of [
  ['source', 'src/input-a.ts', 'export const first = 3;\n'],
  ['type-only', 'src/input-b.ts', 'export type Second = { value: boolean };\n'],
  ['configuration', 'tsconfig.json', null],
]) {
  test(`prepare: changed ${name} input -> stale check preserves bytes until explicit generation`, (t) => {
    const f = fixture(t);
    f.generate();
    if (replacement === null) {
      const config = JSON.parse(readFileSync(join(f.cwd, path), 'utf8'));
      f.put(`${consumer}/${path}`, JSON.stringify({ ...config, compilerOptions: { strict: false } }));
    } else f.put(`${consumer}/${path}`, replacement);
    f.commit('changed input without regeneration');
    const before = outputs.map((output) => readFileSync(join(f.cwd, output), 'utf8'));
    const status = f.git('status', '--porcelain');

    const result = f.prepare();

    assert.equal(result.status, 3, result.stdout + result.stderr);
    for (const index of outputs.keys()) assert.equal(f.typegen(index, true).status, 3);
    assert.deepEqual(outputs.map((output) => readFileSync(join(f.cwd, output), 'utf8')), before);
    assert.equal(f.git('status', '--porcelain'), status);
    f.generate();
    f.generate(true);
    assert.equal(f.git('status', '--porcelain'), '');
  });
}

for (const index of outputs.keys()) {
  for (const [status, defect] of [[4, 'malformed'], [5, 'unsupported']]) {
    test(`prepare: ${defect} target ${index} -> preserves artifact and exit ${status}`, (t) => {
      const f = fixture(t);
      f.generate();
      const path = outputs[index];
      const original = readFileSync(join(f.cwd, path), 'utf8');
      const invalid = status === 4 ? 'not an artifact\n' : original.replace('Artifact version: 2.', 'Artifact version: 99.');
      f.put(`${consumer}/${path}`, invalid);

      const result = f.prepare();

      assert.equal(result.status, status, result.stdout + result.stderr);
      assert.equal(readFileSync(join(f.cwd, path), 'utf8'), invalid);
    });
  }
}

test('prepare: generation failure -> exits one without publishing either target', (t) => {
  const f = fixture(t);
  f.put(`${consumer}/src/app.ts`, 'throw new Error("generation fixture failed");\n');

  const result = f.prepare();

  assert.equal(result.status, 1, result.stdout + result.stderr);
  for (const output of outputs) assert.throws(() => readFileSync(join(f.cwd, output)), { code: 'ENOENT' });
});

test('prepare: fresh consumer with only restored CLI dist -> generates artifacts locally', (t) => {
  const f = fixture(t);
  rmSync(join(f.root, 'packages/cli'));
  mkdirSync(join(f.root, 'packages/cli/bin'), { recursive: true });
  copyFileSync(join(repository, 'packages/cli/bin/fluo.mjs'), join(f.root, 'packages/cli/bin/fluo.mjs'));
  f.put('packages/cli/package.json', '{"type":"module"}');
  symlinkSync(join(repository, 'packages/cli/node_modules'), join(f.root, 'packages/cli/node_modules'), 'dir');
  const archive = join(f.root, 'build.tar');
  execFileSync('tar', ['-cf', archive, 'packages/cli/dist'], { cwd: repository });
  execFileSync('tar', ['-xf', archive], { cwd: f.root });
  rmSync(archive);
  f.commit('consumer source and restored dist');

  const result = f.prepare();

  assert.equal(result.status, 0, result.stdout + result.stderr);
  f.generate(true);
  assert.equal(f.git('status', '--porcelain'), '');
});
