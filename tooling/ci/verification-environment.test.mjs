import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  imageKeyFor,
  loadEnvironmentLock,
  validateVerificationEnvironment,
} from './verification-environment.mjs';

const lockPath = fileURLToPath(new URL('./environment.lock.json', import.meta.url));
const dockerfilePath = fileURLToPath(new URL('./Dockerfile', import.meta.url));

test('rejects wrong platform and architecture instead of accepting native execution', () => {
  const lock = loadEnvironmentLock(lockPath);
  const imageKey = imageKeyFor(lock, readFileSync(dockerfilePath));
  const actual = {
    os: 'linux',
    arch: 'arm64',
    node: Object.fromEntries(Object.entries(lock.node).map(([key, item]) => [key, item.version])),
    pnpm: lock.pnpm.version,
    bun: Object.fromEntries(Object.entries(lock.bun).map(([key, item]) => [key, item.version])),
    deno: Object.fromEntries(Object.entries(lock.deno).map(([key, item]) => [key, item.version])),
    browser: { channel: lock.browser.channel, version: lock.browser.version, launched: true },
    docker: { reachable: true, version: '28.3.3', cliVersion: lock.docker.version },
    redis: { ping: 'PONG', image: lock.redis.image },
    watch: { event: 'change', linuxVolume: true },
  };

  assert.throws(() => validateVerificationEnvironment({ lock, actual: { ...actual, os: 'darwin' }, imageKey }), /linux/);
  assert.equal(lock.platform.arch, 'arm64');
  assert.throws(() => validateVerificationEnvironment({ lock, actual: { ...actual, arch: 'x64' }, imageKey }), /arm64/);
  assert.deepEqual(validateVerificationEnvironment({ lock, actual, imageKey }).node, actual.node);
});

test('rejects runtime drift, missing browser, fixture and watch signals', () => {
  const lock = loadEnvironmentLock(lockPath);
  const imageKey = imageKeyFor(lock, readFileSync(dockerfilePath));
  const actual = {
    os: 'linux',
    arch: 'arm64',
    node: Object.fromEntries(Object.entries(lock.node).map(([key, item]) => [key, item.version])),
    pnpm: lock.pnpm.version,
    bun: Object.fromEntries(Object.entries(lock.bun).map(([key, item]) => [key, item.version])),
    deno: Object.fromEntries(Object.entries(lock.deno).map(([key, item]) => [key, item.version])),
    browser: { channel: lock.browser.channel, version: lock.browser.version, launched: true },
    docker: { reachable: true, version: '28.3.3', cliVersion: lock.docker.version },
    redis: { ping: 'PONG', image: lock.redis.image },
    watch: { event: 'change', linuxVolume: true },
  };

  assert.throws(() => validateVerificationEnvironment({
    lock, actual: { ...actual, node: { ...actual.node, floor: '24.1.0' } }, imageKey,
  }), /floor/);
  assert.throws(() => validateVerificationEnvironment({
    lock, actual: { ...actual, browser: null }, imageKey,
  }), /browser/);
  assert.throws(() => validateVerificationEnvironment({
    lock, actual: { ...actual, browser: { ...actual.browser, launched: false } }, imageKey,
  }), /browser/);
  assert.throws(() => validateVerificationEnvironment({
    lock, actual: { ...actual, docker: { reachable: false, version: null } }, imageKey,
  }), /Docker/);
  assert.throws(() => validateVerificationEnvironment({
    lock, actual: { ...actual, docker: { ...actual.docker, cliVersion: '28.0.0' } }, imageKey,
  }), /Docker/);
  assert.throws(() => validateVerificationEnvironment({
    lock, actual: { ...actual, redis: { ping: 'PONG', image: 'redis:latest' } }, imageKey,
  }), /Redis/);
  assert.throws(() => validateVerificationEnvironment({
    lock, actual: { ...actual, redis: { ping: 'FAILED' } }, imageKey,
  }), /Redis/);
  assert.throws(() => validateVerificationEnvironment({
    lock, actual: { ...actual, watch: { event: null, linuxVolume: true } }, imageKey,
  }), /watch/);
  assert.throws(() => validateVerificationEnvironment({ lock, actual, imageKey: 'sha256:wrong' }), /image/);
  assert.throws(() => validateVerificationEnvironment({
    lock: { ...lock, browser: { ...lock.browser, version: '153.0.0.0' } }, actual, imageKey,
  }), /image/);
});

test('rejects a lock with tampered download hashes', () => {
  const lock = loadEnvironmentLock(lockPath);
  const recipe = readFileSync(dockerfilePath);
  assert.throws(() => imageKeyFor({
    ...lock, node: { ...lock.node, primary: { ...lock.node.primary, sha256: '' } },
  }, recipe), /sha256/);
  assert.throws(() => imageKeyFor({
    ...lock, platform: { ...lock.platform, arch: 'amd64' },
  }, recipe), /arm64/);
  assert.notEqual(imageKeyFor(lock, recipe), imageKeyFor({
    ...lock, bun: { ...lock.bun, '1.4.0': { ...lock.bun['1.4.0'], sha256: '0'.repeat(64) } },
  }, recipe));
  assert.match(lock.browser.url, /\/linux-arm64\/chrome-linux-arm64\.zip$/);
  assert.match(lock.docker.url, /\/aarch64\/docker-28\.3\.3\.tgz$/);
});
