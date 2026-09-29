#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const defaultLockPath = join(here, 'environment.lock.json');
const defaultDockerfilePath = join(here, 'Dockerfile');
const hex = (length, value) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
const command = (name, args, options = {}) => {
  const output = execFileSync(name, args, { encoding: 'utf8', ...options });
  return typeof output === 'string' ? output.trim() : '';
};

export function loadEnvironmentLock(path = defaultLockPath) {
  const lock = JSON.parse(readFileSync(path, 'utf8'));
  if (lock.schemaVersion !== 1 || lock.platform?.os !== 'linux' || lock.platform?.arch !== 'amd64'
    || lock.platform.distribution !== 'debian-bookworm'
    || !/^\d{8}T\d{6}Z$/.test(lock.platform.aptSnapshot ?? '')
    || !/^node:24-bookworm@sha256:[a-f0-9]{64}$/.test(lock.image?.base ?? '')) {
    throw new TypeError('environment lock requires the immutable Debian linux/amd64 base');
  }
  for (const [name, major] of [['primary', '24'], ['compat24', '24'], ['compat26', '26'], ['floor', '24']]) {
    const item = lock.node?.[name];
    if (!new RegExp(`^${major}\\.\\d+\\.\\d+$`).test(item?.version ?? '') || !hex(64, item.sha256)) {
      throw new TypeError(`invalid Node ${name} version or sha256`);
    }
  }
  if (lock.node.compat24.version !== '24.11.0' || lock.node.floor.version !== '24.0.0') {
    throw new TypeError('Node compatibility and runtime-floor versions must remain exact');
  }
  for (const [name, versions] of [['bun', ['1.2.3', '1.4.0']], ['deno', ['2.5.0', '2.9.7']]]) {
    for (const version of versions) {
      if (lock[name]?.[version]?.version !== version || !hex(64, lock[name][version].sha256)) {
        throw new TypeError(`invalid ${name} ${version} sha256`);
      }
    }
  }
  if (lock.pnpm?.version !== '10.4.1' || !hex(128, lock.pnpm.sha512)
    || lock.browser?.channel !== 'chrome' || !hex(64, lock.browser.sha256)
    || !/^\d+\.\d+\.\d+\.\d+$/.test(lock.browser.version ?? '')
    || !hex(64, lock.docker?.sha256)
    || !/^redis:7\.4-alpine@sha256:[a-f0-9]{64}$/.test(lock.redis?.image ?? '')) {
    throw new TypeError('invalid environment download or service lock');
  }
  return lock;
}

export function imageKeyFor(lock, dockerfileBytes, installerBytes = readFileSync(fileURLToPath(import.meta.url))) {
  // Validate supplied locks as well as locks read from disk.
  for (const item of [...Object.values(lock.node ?? {}), ...Object.values(lock.bun ?? {}), ...Object.values(lock.deno ?? {})]) {
    if (!hex(64, item?.sha256)) throw new TypeError('invalid download sha256');
  }
  if (lock.platform?.os !== 'linux' || lock.platform?.arch !== 'amd64') throw new TypeError('image requires linux/amd64');
  const recipe = String(dockerfileBytes);
  if (!recipe.includes(`FROM ${lock.image.base}`)
    || !recipe.includes(`/archive/debian/${lock.platform.aptSnapshot}`)
    || !recipe.includes(`/archive/debian-security/${lock.platform.aptSnapshot}`)) {
    throw new TypeError('image recipe and immutable lock mismatch');
  }
  return `sha256:${hash('sha256', Buffer.concat([
    Buffer.from(JSON.stringify(lock)), Buffer.from(dockerfileBytes), Buffer.from(installerBytes),
  ]))}`;
}

export function prepareVerificationEnvironment({
  lockPath = defaultLockPath,
  dockerfilePath = defaultDockerfilePath,
} = {}) {
  const lock = loadEnvironmentLock(lockPath);
  const imageKey = imageKeyFor(lock, readFileSync(dockerfilePath));
  const tag = `fluo-verification:sha256-${imageKey.slice(7)}`;
  const existing = command('docker', ['image', 'ls', '--quiet', '--filter', `reference=${tag}`]);
  if (!existing) {
    command('docker', ['build', '--platform', 'linux/amd64', '--build-arg', `VERIFICATION_RECIPE_ID=${imageKey}`,
      '--tag', tag, '--file', dockerfilePath, dirname(dockerfilePath)], { stdio: 'inherit' });
  }
  const image = JSON.parse(command('docker', ['image', 'inspect', tag]))[0];
  if (image.Architecture !== 'amd64' || image.Os !== 'linux'
    || image.Config.Labels['org.fluo.verification.image-key'] !== imageKey) {
    throw new Error('built image platform or image key mismatch');
  }
  return { lock, imageKey, imageId: image.Id, tag };
}

export function validateVerificationEnvironment({ lock, actual, imageKey }) {
  if (imageKey !== imageKeyFor(lock, readFileSync(defaultDockerfilePath))) throw new Error('image key mismatch');
  if (actual?.os !== 'linux') throw new Error('linux required');
  if (actual.arch !== 'x64') throw new Error('x64 linux/amd64 required');
  for (const [name, item] of Object.entries(lock.node)) {
    if (actual.node?.[name] !== item.version) throw new Error(`Node ${name} version mismatch`);
  }
  if (actual.pnpm !== lock.pnpm.version) throw new Error('pnpm version mismatch');
  for (const runtime of ['bun', 'deno']) {
    for (const [name, item] of Object.entries(lock[runtime])) {
      if (actual[runtime]?.[name] !== item.version) throw new Error(`${runtime} ${name} version mismatch`);
    }
  }
  if (actual.browser?.channel !== lock.browser.channel || actual.browser.version !== lock.browser.version
    || actual.browser.launched !== true) {
    throw new Error('browser version or channel mismatch');
  }
  if (actual.docker?.reachable !== true || !actual.docker.version
    || actual.docker.cliVersion !== lock.docker.version) throw new Error('Docker CLI or daemon unavailable');
  if (actual.redis?.ping !== 'PONG' || actual.redis.image !== lock.redis.image) {
    throw new Error('Docker Redis fixture unavailable');
  }
  if (actual.watch?.linuxVolume !== true || !['rename', 'change'].includes(actual.watch.event)) {
    throw new Error('linux volume watch event missing');
  }
  return actual;
}

function download(url, destination, algorithm, expected) {
  const temporary = `${destination}.download`;
  mkdirSync(dirname(destination), { recursive: true });
  try {
    command('curl', ['--fail', '--location', '--silent', '--show-error', '--output', temporary, url]);
    if (hash(algorithm, readFileSync(temporary)) !== expected) throw new Error(`checksum mismatch for ${url}`);
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function install() {
  const lock = loadEnvironmentLock();
  for (const { version, sha256 } of Object.values(lock.node)) {
    const archive = `/tmp/node-${version}.tar.xz`;
    download(`https://nodejs.org/dist/v${version}/node-v${version}-linux-x64.tar.xz`, archive, 'sha256', sha256);
    mkdirSync(`/opt/node/${version}`, { recursive: true });
    command('tar', ['-xJf', archive, '--strip-components=1', '-C', `/opt/node/${version}`]);
    rmSync(archive);
  }
  const pnpm = '/tmp/pnpm.tgz';
  download(lock.pnpm.url, pnpm, 'sha512', lock.pnpm.sha512);
  mkdirSync('/opt/pnpm', { recursive: true });
  command('tar', ['-xzf', pnpm, '--strip-components=1', '-C', '/opt/pnpm']);
  symlinkSync('/opt/pnpm/bin/pnpm.cjs', '/usr/local/bin/pnpm');
  rmSync(pnpm);
  for (const { version, sha256 } of Object.values(lock.bun)) {
    const archive = `/tmp/bun-${version}.zip`;
    download(`https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-linux-x64.zip`, archive, 'sha256', sha256);
    mkdirSync(`/opt/bun/${version}`, { recursive: true });
    command('unzip', ['-q', archive, '-d', `/opt/bun/${version}`]);
    renameSync(`/opt/bun/${version}/bun-linux-x64/bun`, `/opt/bun/${version}/bun`);
    rmSync(`/opt/bun/${version}/bun-linux-x64`, { recursive: true });
    rmSync(archive);
  }
  for (const { version, sha256 } of Object.values(lock.deno)) {
    const archive = `/tmp/deno-${version}.zip`;
    download(`https://github.com/denoland/deno/releases/download/v${version}/deno-x86_64-unknown-linux-gnu.zip`,
      archive, 'sha256', sha256);
    mkdirSync(`/opt/deno/${version}`, { recursive: true });
    command('unzip', ['-q', archive, '-d', `/opt/deno/${version}`]);
    rmSync(archive);
  }
  download(lock.browser.url, '/tmp/chrome.zip', 'sha256', lock.browser.sha256);
  mkdirSync('/opt/google/chrome', { recursive: true });
  command('unzip', ['-q', '/tmp/chrome.zip', '-d', '/opt/google/chrome']);
  symlinkSync('/opt/google/chrome/chrome-linux64/chrome', '/opt/google/chrome/chrome');
  symlinkSync('/opt/google/chrome/chrome', '/usr/local/bin/google-chrome');
  rmSync('/tmp/chrome.zip');
  download(lock.docker.url, '/tmp/docker.tgz', 'sha256', lock.docker.sha256);
  command('tar', ['-xzf', '/tmp/docker.tgz', '-C', '/tmp', 'docker/docker']);
  copyFileSync('/tmp/docker/docker', '/usr/local/bin/docker');
  chmodSync('/usr/local/bin/docker', 0o755);
  rmSync('/tmp/docker', { recursive: true });
  rmSync('/tmp/docker.tgz');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'install') install();
    else if (process.argv[2] === 'prepare') console.log(JSON.stringify(prepareVerificationEnvironment()));
    else throw new Error('Usage: verification-environment.mjs <install|prepare>');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
