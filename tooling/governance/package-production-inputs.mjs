import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicWorkspacePackageNames } from '../release/release-intents.mjs';

export const productionInputsPath = 'tooling/governance/package-production-inputs.json';
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const manifestKeys = ['name', 'private', 'scripts', 'type', 'files', 'main', 'module', 'types', 'typings', 'exports', 'bin', 'imports'];
const testModule = /\.test\.(?:mjs|cjs|js|jsx|ts|cts|mts|tsx)$/u;
const fixtureModule = /\.test-fixture\.(?:mjs|cjs|js|jsx|ts|cts|mts|tsx)$/u;
const hash = text => createHash('sha256').update(text).digest('hex');
const fail = message => { throw new TypeError(`${productionInputsPath}: ${message}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const covers = (scope, path) => scope.endsWith('/') ? path.startsWith(scope) : path === scope;
const keys = (value, expected, label) => {
  if (!object(value) || Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) fail(`invalid ${label} fields`);
};
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value) fail(`invalid ${label}`);
};
const unique = (values, label) => {
  if (new Set(values).size !== values.length) fail(`duplicate ${label}`);
};
const literalPackFiles = files => Array.isArray(files) && files.every(path => typeof path === 'string' &&
  /^[\w.@-]+(?:\/[\w.@-]+)*\/?$/u.test(path) &&
  !path.split('/').some(part => part === '.' || part === '..'));

export function productionManifestDigest(manifest) {
  return hash(JSON.stringify(Object.fromEntries(manifestKeys.map(key => [key, manifest[key] ?? null]))));
}

export function validatePackageProductionInputs({ files, readText, readBytes = path => Buffer.from(readText(path), 'utf8'), validation = 'current' }) {
  if (!['current', 'historical'].includes(validation)) fail('unsupported snapshot validation');
  const source = readText(productionInputsPath);
  let declaration;
  try { declaration = JSON.parse(source); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    fail(`invalid JSON: ${error.message}`);
  }
  keys(declaration, ['version', 'owner', 'packages', 'producers', 'manifests', 'nonProduction'], 'declaration');
  if (declaration.version !== 1) fail('unsupported version');
  text(declaration.owner, 'owner');
  if (!Array.isArray(declaration.packages) || !Array.isArray(declaration.producers) || !object(declaration.manifests)) fail('invalid inventory');
  const path = (value, directory = true) => {
    text(value, 'path');
    if (!/^[\w.@-]+(?:\/[\w.@-]+)*\/?$/u.test(value) ||
      value.split('/').some(part => part === '.' || part === '..') ||
      (!directory && value.endsWith('/'))) fail(`unsupported path ${value}`);
    if (!(value.endsWith('/') ? files.some(file => file.startsWith(value)) : files.includes(value))) fail(`missing path ${value}`);
  };
  const rules = (values, flag) => {
    if (!Array.isArray(values)) fail(`invalid ${flag} rules`);
    for (const rule of values) {
      keys(rule, ['path', flag, ...(flag === 'excludeTests'
        ? ['excludeDirectories', 'excludeTestFixtures'].filter(key => Object.hasOwn(rule ?? {}, key)) : [])], 'input rule');
      path(rule.path);
      if (typeof rule[flag] !== 'boolean') fail(`invalid ${flag} at ${rule.path}`);
      if (rule.excludeTestFixtures !== undefined && typeof rule.excludeTestFixtures !== 'boolean') fail(`invalid fixture exclusion at ${rule.path}`);
      if (flag === 'excludeTests' && !rule.path.endsWith('/') &&
        (rule.excludeTests || rule.excludeTestFixtures || rule.excludeDirectories?.length)) fail(`exclusions require a directory input ${rule.path}`);
      if (rule.excludeDirectories !== undefined) {
        if (!Array.isArray(rule.excludeDirectories)) fail(`invalid directory exclusions at ${rule.path}`);
        for (const directory of rule.excludeDirectories) {
          path(directory);
          if (!directory.endsWith('/') || !directory.startsWith(rule.path) || directory === rule.path) fail(`invalid excluded directory ${directory}`);
        }
        unique(rule.excludeDirectories, 'excluded directory');
      }
    }
    unique(values.map(rule => rule.path), 'input path');
  };
  const manifestPaths = files.filter(file => file === 'package.json' ||
    /^(?:packages|apps|examples|tooling)\/[^/]+\/package\.json$/u.test(file)).sort();
  if (Object.keys(declaration.manifests).sort().join('\0') !== manifestPaths.join('\0')) fail('workspace manifest inventory mismatch');
  const manifests = manifestPaths.map(packageJsonPath => {
    let manifest;
    try { manifest = JSON.parse(readText(packageJsonPath)); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      fail(`invalid manifest ${packageJsonPath}`);
    }
    if (!object(manifest) || typeof manifest.name !== 'string' ||
      (manifest.scripts !== undefined && (!object(manifest.scripts) ||
        Object.values(manifest.scripts).some(command => typeof command !== 'string')))) fail(`invalid manifest ${packageJsonPath}`);
    if (!/^[a-f0-9]{64}$/u.test(declaration.manifests[packageJsonPath]) ||
      (validation === 'current' && declaration.manifests[packageJsonPath] !== productionManifestDigest(manifest))) fail(`stale command/runtime definition ${packageJsonPath}`);
    return { packageJsonPath, manifest };
  });
  const publicManifests = manifests.filter(item => /^packages\/[^/]+\/package\.json$/u.test(item.packageJsonPath));
  const publicNames = publicWorkspacePackageNames(publicManifests).sort();
  unique(publicNames, 'public package name');
  if (declaration.packages.some(entry => !object(entry) || typeof entry.name !== 'string' ||
    !/^@fluojs\/[\w.-]+$/u.test(entry.name))) fail('invalid public package identity');
  if (JSON.stringify(declaration.packages.map(entry => entry.name).sort()) !== JSON.stringify(publicNames)) fail('public package inventory mismatch');
  for (const { manifest, packageJsonPath } of publicManifests.filter(item => publicNames.includes(item.manifest.name))) {
    if (!literalPackFiles(manifest.files)) fail(`unsupported files evidence ${packageJsonPath}`);
  }
  for (const entry of declaration.packages) {
    keys(entry, ['name', 'owner', 'inputs', 'nonProduction'], 'package');
    text(entry.owner, `owner of ${entry.name}`);
    rules(entry.inputs, 'excludeTests');
    rules(entry.nonProduction, 'testsOnly');
    const packagePath = publicManifests.find(item => item.manifest.name === entry.name).packageJsonPath.slice(0, -'package.json'.length);
    if (entry.nonProduction.some(rule => !rule.path.startsWith(packagePath))) fail(`nonProduction outside package ${entry.name}`);
  }
  unique(declaration.packages.map(entry => entry.name), 'package');
  for (const producer of declaration.producers) {
    keys(producer, ['id', 'owner', 'consumers', 'inputs', 'definitions',
      ...(Object.hasOwn(producer ?? {}, 'definitionScopes') ? ['definitionScopes'] : [])], 'producer');
    text(producer.id, 'producer id');
    text(producer.owner, `owner of ${producer.id}`);
    if (!Array.isArray(producer.consumers) || !producer.consumers.length ||
      producer.consumers.some(name => !publicNames.includes(name))) fail(`invalid consumers of ${producer.id}`);
    unique(producer.consumers, 'consumer');
    rules(producer.inputs, 'excludeTests');
    if (!object(producer.definitions)) fail(`invalid definitions of ${producer.id}`);
    if (producer.definitionScopes !== undefined) {
      if (!Array.isArray(producer.definitionScopes)) fail(`invalid definition scopes of ${producer.id}`);
      unique(producer.definitionScopes, 'definition scope');
      for (const scope of producer.definitionScopes) {
        path(scope);
        if (!scope.endsWith('/')) fail(`definition scope must be a directory ${scope}`);
        for (const file of files.filter(file => file.startsWith(scope))) {
          if (!Object.hasOwn(producer.definitions, file)) fail(`undeclared producer definition ${file}`);
        }
      }
    }
    for (const [definition, digest] of Object.entries(producer.definitions)) {
      path(definition, false);
      const bytes = readBytes(definition);
      if (!/^[a-f0-9]{64}$/u.test(digest) || (validation === 'current' && hash(bytes) !== digest)) fail(`stale producer definition ${definition}`);
    }
  }
  unique(declaration.producers.map(producer => producer.id), 'producer id');
  for (const name of publicNames) {
    if (!declaration.producers.some(producer => producer.consumers.includes(name))) fail(`missing producer for ${name}`);
  }
  rules(declaration.nonProduction, 'testsOnly');
  return { declaration, manifests: publicManifests.filter(item => publicNames.includes(item.manifest.name)), files };
}

export function assertProductionInputsPreserved(previous, current) {
  if (Object.keys(previous.declaration.manifests).some(path => !Object.hasOwn(current.declaration.manifests, path))) fail('removed command/runtime definition');
  const retained = (before, after, label) => {
    for (const input of before) {
      if (!after.some(next => covers(next.path, input.path) &&
        (!next.excludeTests || input.excludeTests) &&
        (!next.excludeTestFixtures || input.excludeTestFixtures) &&
        (next.excludeDirectories ?? []).every(directory => (input.excludeDirectories ?? []).some(old => covers(old, directory))))) fail(`removed or narrowed production input ${label}:${input.path}`);
    }
  };
  for (const entry of previous.declaration.packages) {
    const next = current.declaration.packages.find(item => item.name === entry.name);
    if (!next) fail(`removed public declaration ${entry.name}`);
    retained(entry.inputs, next.inputs, entry.name);
  }
  for (const producer of previous.declaration.producers) {
    const next = current.declaration.producers.find(item => item.id === producer.id);
    if (!next || producer.consumers.some(name => !next.consumers.includes(name)) ||
      Object.keys(producer.definitions).some(path => !Object.hasOwn(next.definitions, path)) ||
      (producer.definitionScopes ?? []).some(scope => !(next.definitionScopes ?? []).some(path => covers(path, scope)))) fail(`removed producer/consumer/definition ${producer.id}`);
    retained(producer.inputs, next.inputs, producer.id);
  }
}

export function consumerVisibleFromInputs(file, snapshot) {
  const { declaration, manifests } = snapshot;
  if (!declaration.packages.length) return file.startsWith('packages/');
  const production = [...declaration.packages, ...declaration.producers].some(entry =>
    entry.inputs.some(input => covers(input.path, file) && (!input.excludeTests || !testModule.test(file)) &&
      (!input.excludeTestFixtures || !fixtureModule.test(file)) &&
      !(input.excludeDirectories ?? []).some(directory => covers(directory, file))));
  if (production || Object.hasOwn(declaration.manifests, file) ||
    declaration.producers.some(producer => Object.hasOwn(producer.definitions, file))) return true;
  const owner = manifests.find(item => file.startsWith(item.packageJsonPath.slice(0, -'package.json'.length)));
  if (owner) {
    const relative = file.slice(owner.packageJsonPath.length - 'package.json'.length);
    const files = owner.manifest.files;
    if (/^(?:dist|bin)\//u.test(relative) ||
      (!relative.includes('/') && /^(?:README|LICENSE|LICENCE)/iu.test(relative)) ||
      relative.includes('/templates/') ||
      files.some(path => covers(path.replace(/^\.\//u, '').replace(/\/$/u, '') + '/', relative) ||
        relative === path.replace(/^\.\//u, '').replace(/\/$/u, ''))) return true;
  }
  const nonProduction = [...declaration.nonProduction, ...declaration.packages.flatMap(entry => entry.nonProduction)];
  return !nonProduction.some(rule => covers(rule.path, file) &&
    (!rule.testsOnly || testModule.test(file) || fixtureModule.test(file)));
}

export function readPackageProductionInputs(root = repoRoot, ref = 'HEAD', validation = 'current') {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const records = git(['ls-tree', '-r', '-z', ref]).split('\0').filter(Boolean);
  const modes = new Map(records.map(record => [record.slice(record.indexOf('\t') + 1), record.slice(0, 6)]));
  const files = [...modes.keys()];
  const readBytes = path => {
    if (!['100644', '100755'].includes(modes.get(path))) fail(`missing or unsupported Git file ${ref}:${path}`);
    return execFileSync('git', ['show', `${ref}:${path}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  };
  return validatePackageProductionInputs({ files, readText: path => readBytes(path).toString('utf8'), readBytes, validation });
}

export function productionInputClassifier(root = repoRoot, head = 'HEAD', base = head) {
  try {
    const current = readPackageProductionInputs(root, head);
    const previous = base === head ? current : readPackageProductionInputs(root, base, 'historical');
    assertProductionInputsPreserved(previous, current);
    return file => consumerVisibleFromInputs(file, current) || consumerVisibleFromInputs(file, previous);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return () => true;
  }
}

export function enforcePackageProductionInputs(root = repoRoot, ref = 'HEAD') {
  const current = readPackageProductionInputs(root, ref);
  const parents = execFileSync('git', ['show', '-s', '--format=%P', ref], { cwd: root, encoding: 'utf8' }).trim().split(' ').filter(Boolean);
  if (parents.length) {
    const files = execFileSync('git', ['ls-tree', '-r', '--name-only', parents[0]], { cwd: root, encoding: 'utf8' }).split('\n');
    if (files.includes(productionInputsPath)) assertProductionInputsPreserved(readPackageProductionInputs(root, parents[0], 'historical'), current);
  }
  return current;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    enforcePackageProductionInputs();
    console.log('Package production inputs are valid.');
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}
