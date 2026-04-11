import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(packageRoot, '..', '..', '..');

function read(relativePath: string) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function expectAll(document: string, snippets: string[]) {
  for (const snippet of snippets) {
    expect(document).toContain(snippet);
  }
}

describe('runtime matrix docs contract', () => {
  it('keeps package-surface as the canonical runtime matrix source', () => {
    expect(read('docs/reference/package-surface.md')).toContain('## canonical runtime package matrix');
    expect(read('docs/reference/package-surface.ko.md')).toContain('## canonical runtime package matrix');
  });

  it('keeps task and hub docs pointed at the canonical matrix', () => {
    expect(read('docs/reference/package-chooser.md')).toContain('./package-surface.md#canonical-runtime-package-matrix');
    expect(read('docs/reference/package-chooser.ko.md')).toContain(
      './package-surface.ko.md#canonical-runtime-package-matrix',
    );
    expect(read('docs/README.md')).toContain('reference/package-surface.md');
    expect(read('docs/README.ko.md')).toContain('reference/package-surface.ko.md');
    expect(read('README.md')).toContain('docs/reference/package-surface.md');
    expect(read('README.ko.md')).toContain('docs/reference/package-surface.ko.md');
    expect(read('packages/cli/README.md')).toContain('../../docs/reference/package-surface.md');
    expect(read('packages/cli/README.ko.md')).toContain('../../docs/reference/package-surface.ko.md');
  });

  it('publishes a clear fluo new support matrix and keeps linked docs aligned to it', () => {
    expectAll(read('docs/reference/fluo-new-support-matrix.md'), [
      'Application starter',
      'Microservice starter',
      'Mixed starter',
      'Documented, not wired into `fluo new` yet',
      '@fluojs/platform-express',
      '@fluojs/platform-bun',
      '@fluojs/platform-deno',
      '@fluojs/platform-cloudflare-workers',
    ]);
    expectAll(read('docs/reference/fluo-new-support-matrix.ko.md'), [
      '애플리케이션 스타터',
      '마이크로서비스 스타터',
      'mixed 스타터',
      '문서화됨, 아직 `fluo new`에는 연결되지 않음',
      '@fluojs/platform-express',
      '@fluojs/platform-bun',
      '@fluojs/platform-deno',
      '@fluojs/platform-cloudflare-workers',
    ]);
    expect(read('docs/README.md')).toContain('./reference/fluo-new-support-matrix.md');
    expect(read('docs/README.ko.md')).toContain('./reference/fluo-new-support-matrix.ko.md');
    expect(read('docs/reference/package-chooser.md')).toContain('./fluo-new-support-matrix.md');
    expect(read('docs/reference/package-chooser.ko.md')).toContain('./fluo-new-support-matrix.ko.md');
    expect(read('docs/getting-started/quick-start.md')).toContain('../reference/fluo-new-support-matrix.md');
    expect(read('docs/getting-started/quick-start.ko.md')).toContain('../reference/fluo-new-support-matrix.ko.md');
    expect(read('docs/getting-started/bootstrap-paths.md')).toContain('../reference/fluo-new-support-matrix.md');
    expect(read('docs/getting-started/bootstrap-paths.ko.md')).toContain('../reference/fluo-new-support-matrix.ko.md');
    expect(read('docs/getting-started/migrate-from-nestjs.md')).toContain('../reference/fluo-new-support-matrix.md');
    expect(read('docs/getting-started/migrate-from-nestjs.ko.md')).toContain('../reference/fluo-new-support-matrix.ko.md');
    expect(read('packages/cli/README.md')).toContain('../../docs/reference/fluo-new-support-matrix.md');
    expect(read('packages/cli/README.ko.md')).toContain('../../docs/reference/fluo-new-support-matrix.ko.md');
  });

  it('keeps toolchain docs delegating runtime matrix ownership', () => {
    expect(read('docs/reference/toolchain-contract-matrix.md')).toContain('./package-surface.md');
    expect(read('docs/reference/toolchain-contract-matrix.ko.md')).toContain('./package-surface.ko.md');
  });

  it('keeps published fluo new v2 paths aligned across CLI and quick-start docs', () => {
    expectAll(read('packages/cli/README.md'), [
      '--shape application --transport http --runtime node --platform fastify',
      '--shape microservice --transport tcp --runtime node --platform none',
      '--shape mixed --transport tcp --runtime node --platform fastify',
      'interactive TTY',
    ]);
    expectAll(read('packages/cli/README.ko.md'), [
      '--shape application --transport http --runtime node --platform fastify',
      '--shape microservice --transport tcp --runtime node --platform none',
      '--shape mixed --transport tcp --runtime node --platform fastify',
      'interactive TTY',
    ]);
    expectAll(read('docs/getting-started/quick-start.md'), [
      '--shape application --transport http --runtime node --platform fastify',
      '--shape microservice --transport tcp --runtime node --platform none',
      '--shape mixed --transport tcp --runtime node --platform fastify',
      'interactive terminal',
    ]);
    expectAll(read('docs/getting-started/quick-start.ko.md'), [
      '--shape application --transport http --runtime node --platform fastify',
      '--shape microservice --transport tcp --runtime node --platform none',
      '--shape mixed --transport tcp --runtime node --platform fastify',
      'interactive terminal',
    ]);
  });

  it('keeps contract matrix and example docs aligned to the published starter split', () => {
    expectAll(read('docs/reference/toolchain-contract-matrix.md'), [
      'Project Creation (explicit HTTP)',
      'Project Creation (microservice)',
      'Project Creation (mixed)',
      'Interactive wizard',
    ]);
    expectAll(read('docs/reference/toolchain-contract-matrix.ko.md'), [
      '프로젝트 생성 (명시적 HTTP)',
      '프로젝트 생성 (microservice)',
      '프로젝트 생성 (mixed)',
      'Interactive wizard',
    ]);
    expectAll(read('examples/README.md'), [
      'HTTP side of the published `fluo new` v2 matrix',
      'runnable TCP microservice path',
      'mixed single-package path',
    ]);
    expectAll(read('examples/README.ko.md'), [
      '공개된 `fluo new` v2 매트릭스의 HTTP 쪽 경로',
      'TCP microservice 경로',
      'mixed single-package 경로',
    ]);
    expectAll(read('examples/minimal/README.md'), [
      'default and explicit HTTP v2 starter',
      '--shape application --transport http --runtime node --platform fastify',
    ]);
    expectAll(read('examples/minimal/README.ko.md'), [
      '기본/명시적 HTTP v2 스타터',
      '--shape application --transport http --runtime node --platform fastify',
    ]);
    expectAll(read('examples/realworld-api/README.md'), [
      'HTTP v2 starter-aligned',
      'not a microservice or mixed-topology example',
    ]);
    expectAll(read('examples/realworld-api/README.ko.md'), [
      'HTTP v2 스타터 정렬',
      'microservice 또는 mixed-topology 예제는 아닙니다',
    ]);
  });
});
