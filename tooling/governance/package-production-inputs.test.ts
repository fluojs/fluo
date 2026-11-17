import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertProductionInputsPreserved,
  consumerVisibleFromInputs,
  enforcePackageProductionInputs,
  productionInputClassifier,
  productionInputsPath,
  productionManifestDigest,
  validatePackageProductionInputs,
} from './package-production-inputs.mjs';

function declaredFixture() {
  const manifestPath = 'packages/unit/package.json';
  const producerPath = 'tooling/build.mjs';
  const input = 'packages/unit/scripts/check.test.mjs';
  const manifest = {
    name: '@fluojs/unit', publishConfig: { access: 'public' }, files: ['dist'],
    version: '1.0.0', scripts: { build: 'node ../../tooling/build.mjs' },
  };
  const files = new Map([
    [manifestPath, JSON.stringify(manifest)],
    [producerPath, 'export const producer = true;\n'],
    [input, 'base\n'],
    ['packages/unit/src/value.ts', 'export const value = true;\n'],
    ['packages/unit/scripts/unconsumed.test.mjs', '// genuine test\n'],
    ['packages/unit/fixtures/data.json', '{}'],
    ['docs/guide.md', 'guide'],
  ]);
  const definitions: Record<string, string> = {
    [producerPath]: createHash('sha256').update(files.get(producerPath) ?? '').digest('hex'),
  };
  const manifests: Record<string, string> = { [manifestPath]: productionManifestDigest(manifest) };
  const data = {
    version: 1, owner: 'fixture-maintainer',
    packages: [{
      name: '@fluojs/unit', owner: 'fixture-maintainer',
      inputs: [{ path: 'packages/unit/src/', excludeTests: true }],
      nonProduction: [
        { path: 'packages/unit/', testsOnly: true },
        { path: 'packages/unit/fixtures/', testsOnly: false },
      ],
    }],
    producers: [{
      id: 'unit-build', owner: 'fixture-maintainer', consumers: ['@fluojs/unit'],
      inputs: [{ path: input, excludeTests: false }],
      definitions,
    }],
    manifests,
    nonProduction: [{ path: 'docs/', testsOnly: false }],
  };
  const save = (value: unknown = data) => files.set(productionInputsPath, JSON.stringify(value));
  const source = () => ({
    files: [...files.keys()],
    readText: (path: string): string => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`Missing fixture path ${path}`);
      return value;
    },
  });
  const load = () => { save(); return validatePackageProductionInputs(source()); };
  return { data, files, manifest, manifestPath, producerPath, input, save, source, load };
}

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function gitFixture(fixture: ReturnType<typeof declaredFixture>) {
  const root = mkdtempSync(join(tmpdir(), 'fluo-production-inputs-'));
  temporaryRoots.push(root);
  const env = { ...process.env, GIT_AUTHOR_NAME: 'fixture', GIT_COMMITTER_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_COMMITTER_EMAIL: 'fixture@example.test' };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  fixture.save();
  for (const [path, content] of fixture.files) write(path, content);
  git('init', '-b', 'main');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-m', 'declared input base');
  return { root, git, write };
}

describe('declared package production inputs', () => {
  it.each([
    'scripts/check.test.mjs', 'scripts/check.test.cjs', 'scripts/check.test.js',
    'src/check.test.ts', 'src/check.test.cts', 'src/check.test.mts',
    'src/check.test-fixture.ts', 'test/data.json', 'test-types/helper.d.ts',
    '__tests__/helper.js', 'fixtures/data.json', 'CHANGELOG.md',
    '../../ROOT.test.js', '../../tooling/data.test.js', '../sibling/input.test.mjs',
  ])('retains production precedence for %s', relative => {
    const fixture = declaredFixture();
    const path = relative.startsWith('../../') ? relative.slice(6)
      : relative.startsWith('../') ? `packages/${relative.slice(3)}` : `packages/unit/${relative}`;
    fixture.files.set(path, 'consumed payload');
    fixture.data.producers[0].inputs = [{ path, excludeTests: false }];

    const snapshot = fixture.load();

    expect(consumerVisibleFromInputs(path, snapshot)).toBe(true);
    expect(consumerVisibleFromInputs('packages/unit/scripts/unconsumed.test.mjs', snapshot)).toBe(false);
  });

  it('keeps ordinary source, packed tests and root README visible alongside genuine nonshipping paths', () => {
    const snapshot = declaredFixture().load();
    expect(consumerVisibleFromInputs('packages/unit/src/value.ts', snapshot)).toBe(true);
    expect(consumerVisibleFromInputs('packages/unit/dist/check.test.js', snapshot)).toBe(true);
    expect(consumerVisibleFromInputs('packages/unit/README.ko.md', snapshot)).toBe(true);
    expect(consumerVisibleFromInputs('packages/unit/src/fixtures/value.ts', snapshot)).toBe(true);
    expect(consumerVisibleFromInputs('packages/unit/fixtures/data.json', snapshot)).toBe(false);
    expect(consumerVisibleFromInputs('docs/guide.md', snapshot)).toBe(false);
    expect(consumerVisibleFromInputs('packages/unitary/unknown.test.mjs', snapshot)).toBe(true);
  });

  it.each([
    { files: ['dist', 'check.test.cjs'], error: null },
    { files: ['dist/**'], error: /unsupported files evidence/u },
  ])('validates literal packed files without trusting unsupported patterns: $files', ({ files, error }) => {
    const fixture = declaredFixture();
    const manifest = { ...fixture.manifest, files };
    fixture.files.set(fixture.manifestPath, JSON.stringify(manifest));
    fixture.files.set('packages/unit/check.test.cjs', '// packed test-shaped input');
    fixture.data.manifests[fixture.manifestPath] = productionManifestDigest(manifest);
    if (error) expect(() => fixture.load()).toThrow(error);
    else expect(consumerVisibleFromInputs('packages/unit/check.test.cjs', fixture.load())).toBe(true);
  });

  it.each(['test/', 'test-types/', 'test-fixtures/', '__tests__/', 'fixtures/'])('excludes a genuinely declared %s support scope', directory => {
    const fixture = declaredFixture();
    const path = `packages/unit/${directory}helper.ts`;
    fixture.files.set(path, 'test support');
    if (!fixture.data.packages[0].nonProduction.some(rule => rule.path === `packages/unit/${directory}`)) {
      fixture.data.packages[0].nonProduction.push({ path: `packages/unit/${directory}`, testsOnly: false });
    }
    expect(consumerVisibleFromInputs(path, fixture.load())).toBe(false);
  });

  it('bounds directory exclusions and lets an explicit producer input override them', () => {
    const fixture = declaredFixture();
    const helper = 'packages/unit/src/test-support/helper.ts';
    fixture.files.set(helper, 'support helper');
    const data = {
      ...fixture.data,
      packages: [{
        ...fixture.data.packages[0],
        inputs: [{ path: 'packages/unit/src/', excludeTests: true, excludeDirectories: ['packages/unit/src/test-support/'] }],
        nonProduction: [...fixture.data.packages[0].nonProduction, { path: 'packages/unit/src/test-support/', testsOnly: false }],
      }],
    };
    fixture.save(data);
    expect(consumerVisibleFromInputs(helper, validatePackageProductionInputs(fixture.source()))).toBe(false);
    data.producers[0].inputs.push({ path: helper, excludeTests: false });
    fixture.save(data);
    expect(consumerVisibleFromInputs(helper, validatePackageProductionInputs(fixture.source()))).toBe(true);
    fixture.save({ ...data, packages: [{ ...data.packages[0], inputs: [{
      path: 'packages/unit/src/', excludeTests: true, excludeDirectories: ['docs/'],
    }] }] });
    expect(() => validatePackageProductionInputs(fixture.source())).toThrow(/invalid excluded directory/u);
  });

  const invalidDeclarations: readonly {
    label: string;
    change: (fixture: ReturnType<typeof declaredFixture>) => unknown;
    error: RegExp;
  }[] = [
    { label: 'version', change: f => ({ ...f.data, version: 2 }), error: /unsupported version/u },
    { label: 'owner', change: f => ({ ...f.data, owner: '' }), error: /owner/u },
    { label: 'extra fields', change: f => ({ ...f.data, arbitrary: true }), error: /fields/u },
    { label: 'missing public package', change: f => ({ ...f.data, packages: [] }), error: /public package inventory/u },
    { label: 'duplicate package', change: f => ({ ...f.data, packages: [...f.data.packages, ...f.data.packages] }), error: /inventory|duplicate/u },
    { label: 'missing producer', change: f => ({ ...f.data, producers: [] }), error: /missing producer/u },
    { label: 'unknown consumer', change: f => ({ ...f.data, producers: [{ ...f.data.producers[0], consumers: ['@fluojs/absent'] }] }), error: /consumers/u },
    { label: 'duplicate producer', change: f => ({ ...f.data, producers: [...f.data.producers, ...f.data.producers] }), error: /duplicate producer/u },
    { label: 'parent traversal', change: f => ({ ...f.data, nonProduction: [{ path: '../data', testsOnly: false }] }), error: /unsupported path/u },
    { label: 'absolute path', change: f => ({ ...f.data, nonProduction: [{ path: '/data', testsOnly: false }] }), error: /unsupported path/u },
    { label: 'glob', change: f => ({ ...f.data, nonProduction: [{ path: 'packages/**', testsOnly: false }] }), error: /unsupported path/u },
    { label: 'missing path', change: f => ({ ...f.data, nonProduction: [{ path: 'packages/absent/', testsOnly: false }] }), error: /missing path/u },
    { label: 'duplicate path', change: f => ({ ...f.data, nonProduction: [...f.data.nonProduction, ...f.data.nonProduction] }), error: /duplicate input path/u },
    { label: 'wrong flag', change: f => ({ ...f.data, nonProduction: [{ path: 'docs/', testsOnly: 'yes' }] }), error: /testsOnly/u },
    { label: 'package exclusion ownership', change: f => ({ ...f.data, packages: [{
      ...f.data.packages[0], nonProduction: [{ path: 'docs/', testsOnly: false }],
    }] }), error: /nonProduction outside package/u },
    { label: 'exact production input exclusion', change: f => ({ ...f.data, producers: [{
      ...f.data.producers[0], inputs: [{ path: f.input, excludeTests: true }],
    }] }), error: /exclusions require a directory input/u },
  ];
  it.each(invalidDeclarations)('rejects $label with a concrete diagnosis', ({ change, error }) => {
    const fixture = declaredFixture();
    fixture.save(change(fixture));
    expect(() => validatePackageProductionInputs(fixture.source())).toThrow(error);
  });

  it('rejects newly connected workspace commands and new workspace inventory', () => {
    const fixture = declaredFixture();
    fixture.files.set(fixture.manifestPath, JSON.stringify({
      ...fixture.manifest, scripts: { ...fixture.manifest.scripts, prepack: 'node external.mjs' },
    }));
    expect(() => fixture.load()).toThrow(/stale command\/runtime definition/u);
    fixture.files.set('packages/private/package.json', '{"name":"private","private":true}');
    expect(() => fixture.load()).toThrow(/workspace manifest inventory/u);
  });

  it('does not stale producer definitions for payload, package-version or dependency-version updates', () => {
    const fixture = declaredFixture();
    fixture.files.set(fixture.input, 'updated payload');
    fixture.files.set(fixture.manifestPath, JSON.stringify({
      ...fixture.manifest, version: '2.0.0', dependencies: { dependency: '^2.0.0' },
    }));
    expect(consumerVisibleFromInputs(fixture.input, fixture.load())).toBe(true);
  });

  it('keeps compiled fixture modules visible unless the owner explicitly excludes them', () => {
    const fixture = declaredFixture();
    const path = 'packages/unit/src/value.test-fixture.ts';
    fixture.files.set(path, 'compiled fixture');
    expect(consumerVisibleFromInputs(path, fixture.load())).toBe(true);
    fixture.save({
      ...fixture.data,
      packages: [{ ...fixture.data.packages[0], inputs: [{
        path: 'packages/unit/src/', excludeTests: true, excludeTestFixtures: true,
      }] }],
    });
    expect(consumerVisibleFromInputs(path, validatePackageProductionInputs(fixture.source()))).toBe(false);
  });

  it('authenticates raw producer bytes rather than a lossy text decoding', () => {
    const fixture = declaredFixture();
    const bytes = Uint8Array.from([0, 255, 128, 10]);
    fixture.data.producers[0].definitions[fixture.producerPath] = createHash('sha256').update(bytes).digest('hex');
    fixture.save();
    const source = fixture.source();
    const snapshot = validatePackageProductionInputs({
      ...source,
      readText: path => path === fixture.producerPath ? Buffer.from(bytes).toString('utf8') : source.readText(path),
      readBytes: path => path === fixture.producerPath ? bytes : Buffer.from(source.readText(path), 'utf8'),
    });
    expect(consumerVisibleFromInputs(fixture.producerPath, snapshot)).toBe(true);
  });

  it('detects newly connected config definitions and rejects removing their inventory scope', () => {
    const fixture = declaredFixture();
    const config = 'tooling/reader-defs/build.json';
    fixture.files.set(config, '{}');
    const data = {
      ...fixture.data,
      producers: [{
        ...fixture.data.producers[0], definitionScopes: ['tooling/reader-defs/'],
        definitions: { ...fixture.data.producers[0].definitions, [config]: createHash('sha256').update('{}').digest('hex') },
      }],
    };
    fixture.save(data);
    const previous = validatePackageProductionInputs(fixture.source());
    fixture.files.set('tooling/reader-defs/new-build.mjs', 'new reader');
    expect(() => validatePackageProductionInputs(fixture.source())).toThrow(/undeclared producer definition/u);
    fixture.files.delete('tooling/reader-defs/new-build.mjs');
    data.producers[0].definitionScopes = [];
    fixture.save(data);
    expect(() => assertProductionInputsPreserved(previous, validatePackageProductionInputs(fixture.source())))
      .toThrow(/removed producer\/consumer\/definition/u);
  });

  it('rejects stale or deleted executable definitions without turning observation failure into an empty inventory', () => {
    const fixture = declaredFixture();
    fixture.files.set(fixture.producerPath, 'changed reader');
    expect(() => fixture.load()).toThrow(/stale producer definition/u);
    fixture.files.delete(fixture.producerPath);
    expect(() => fixture.load()).toThrow(/missing path/u);
    const source = fixture.source();
    expect(() => validatePackageProductionInputs({ ...source, readText: () => { throw new Error('Git read failed'); } }))
      .toThrow('Git read failed');
  });

  it.each(['input', 'test exclusion', 'definition', 'producer'] as const)('retains previous production evidence after a %s shrink', kind => {
    const fixture = declaredFixture();
    const previous = fixture.load();
    switch (kind) {
      case 'input': fixture.data.producers[0].inputs = []; break;
      case 'test exclusion': fixture.data.producers[0].inputs[0].excludeTests = true; break;
      case 'definition': fixture.data.producers[0].definitions = {}; break;
      case 'producer': fixture.data.producers = []; break;
    }
    const validate = () => assertProductionInputsPreserved(previous, fixture.load());
    expect(validate).toThrow(/removed|narrowed|missing producer|exclusions require a directory input/u);
  });

  it('reads the selected Git objects, ignores dirty declarations and keeps deleted inputs consumer-visible', () => {
    const fixture = declaredFixture();
    const git = gitFixture(fixture);
    const base = git.git('rev-parse', 'HEAD');
    git.write(productionInputsPath, '{}');
    expect(productionInputClassifier(git.root)(fixture.input)).toBe(true);
    expect(productionInputClassifier(git.root)('packages/unit/scripts/unconsumed.test.mjs')).toBe(false);
    git.git('rm', fixture.input);
    git.git('-c', 'commit.gpgsign=false', 'commit', '-m', 'remove input');
    expect(productionInputClassifier(git.root, 'HEAD', base)(fixture.input)).toBe(true);
    expect(() => enforcePackageProductionInputs(git.root)).toThrow(/missing path/u);
  });

  it('does not use a newly introduced declaration as evidence of nonshipping at an undeclared old base', () => {
    const fixture = declaredFixture();
    const git = gitFixture(fixture);
    git.git('rm', productionInputsPath);
    git.git('-c', 'commit.gpgsign=false', 'commit', '-m', 'old base without declaration');
    const oldBase = git.git('rev-parse', 'HEAD');
    git.write(productionInputsPath, JSON.stringify(fixture.data));
    git.git('add', productionInputsPath);
    git.git('-c', 'commit.gpgsign=false', 'commit', '-m', 'introduce declaration');
    expect(productionInputClassifier(git.root, 'HEAD', oldBase)('packages/unit/scripts/unconsumed.test.mjs')).toBe(true);
    expect(productionInputClassifier(git.root)('packages/unit/scripts/unconsumed.test.mjs')).toBe(false);
  });

  it('does not erase a previous workspace command definition by deleting its manifest and record together', () => {
    const fixture = declaredFixture();
    const path = 'packages/private/package.json';
    const manifest = { name: 'private-reader', private: true, scripts: { build: 'node reader.mjs' } };
    fixture.files.set(path, JSON.stringify(manifest));
    fixture.data.manifests[path] = productionManifestDigest(manifest);
    const previous = fixture.load();
    fixture.files.delete(path);
    delete fixture.data.manifests[path];
    expect(() => assertProductionInputsPreserved(previous, fixture.load())).toThrow(/removed command\/runtime definition/u);
  });
});
