import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const {
  publishCanonicalVerificationReceipt,
  resolveTrustedPnpmStore,
  verificationRuntimePrefix,
} = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/canonical-verification.mjs',
  )
);
const {
  runContainedVerification,
  darwinVerificationProfile,
  verificationEnvironment,
  vitestSerialHookSource,
} = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/verification-containment.mjs',
  )
);
const { withGlobalCanonicalVerificationLease } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/review-loop-policy.mjs',
  )
);

describe('execute-lane canonical verification pnpm store', () => {
  it('force-fetches the lockfile store before validating it', () => {
    const root = realpathSync(
      mkdtempSync(join(realpathSync(tmpdir()), 'fluo-canonical-store-')),
    );
    const runtimeRoot = resolve(root, 'runtime');
    const store = resolve(runtimeRoot, 'pnpm-store');
    writeFileSync(resolve(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
    writeFileSync(
      resolve(root, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@10.4.1' }),
    );
    const execute = vi.fn(
      (_command: string, _args: readonly string[]) => {
        mkdirSync(store, { recursive: true });
        return '';
      },
    );

    try {
      expect(
        resolveTrustedPnpmStore(root, root, runtimeRoot, { execute }),
      ).toEqual(
        expect.objectContaining({ path: store }),
      );
      expect(
        resolveTrustedPnpmStore(root, root, runtimeRoot, { execute }),
      ).toEqual(
        expect.objectContaining({ path: store }),
      );
      expect(execute).toHaveBeenNthCalledWith(
        1,
        'pnpm',
        expect.arrayContaining([
          'fetch',
          '--force',
          '--frozen-lockfile',
          '--ignore-scripts',
          '--ignore-pnpmfile',
          '--store-dir',
          store,
        ]),
        expect.objectContaining({
          cwd: expect.not.stringMatching(new RegExp(`^${root}$`, 'u')),
          env: expect.objectContaining({
            HOME: expect.stringContaining('canonical-store-bootstrap'),
          }),
        }),
      );
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('execute-lane canonical verification containment', () => {
  it('permits only localhost networking on Darwin', () => {
    const profile = darwinVerificationProfile('/tmp/disposable', '/tmp/runtime');

    expect(profile).toContain(
      '(allow network* (local ip "localhost:*"))',
    );
    expect(profile).toContain(
      '(allow network* (remote ip "localhost:*"))',
    );
    expect(profile).toContain(
      '(allow signal (target same-sandbox))',
    );
    expect(profile).not.toContain('(allow signal)');
    expect(profile).not.toContain('(allow network*)');
  });

  it('serializes test files that share generated dist artifacts', () => {
    const environment = verificationEnvironment('/tmp/runtime');
    expect(environment).toMatchObject({
      FLUO_CANONICAL_VERIFICATION: '1',
    });
    expect(environment.NODE_OPTIONS).toContain(
      '/tmp/runtime/vitest-serial.cjs',
    );

    const root = realpathSync(
      mkdtempSync(join(realpathSync(tmpdir()), 'fluo-vitest-hook-')),
    );
    const hookPath = resolve(root, 'vitest-serial.cjs');
    const entryPath = resolve(root, 'vitest');
    writeFileSync(hookPath, vitestSerialHookSource);
    writeFileSync(
      entryPath,
      'process.stdout.write(JSON.stringify(process.argv.slice(2)));',
    );
    try {
      const result = spawnSync(
        process.execPath,
        [entryPath, 'run'],
        {
          encoding: 'utf8',
          env: verificationEnvironment(root),
        },
      );
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([
        'run',
        '--no-file-parallelism',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps mutable verification scratch outside the disposable repository', () => {
    expect(
      verificationRuntimePrefix('/tmp/canonical-runtime', 'verify'),
    ).toBe('/tmp/canonical-runtime/.canonical-verification-verify-');
  });

  it.runIf(process.platform === 'darwin')(
    'terminates a verification daemon that escapes the candidate process group',
    async () => {
      const root = realpathSync(
        mkdtempSync(join(realpathSync(tmpdir()), 'fluo-daemon-cleanup-')),
      );
      const disposable = resolve(root, 'disposable');
      const runtime = resolve(root, 'runtime');
      const store = resolve(root, 'store');
      const bin = resolve(root, 'bin');
      const daemonMarker = resolve(runtime, 'daemon-terminated');
      const originalPath = process.env.PATH;
      mkdirSync(disposable);
      mkdirSync(runtime);
      mkdirSync(store);
      mkdirSync(bin);
      const lockfile = 'lockfileVersion: 9.0\n';
      writeFileSync(resolve(disposable, 'pnpm-lock.yaml'), lockfile);
      const fakePnpm = resolve(bin, 'pnpm');
      writeFileSync(
        fakePnpm,
        `#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const daemon = spawn(process.execPath, ['-e', ${JSON.stringify(
          `const { writeFileSync } = require('node:fs');
process.on('SIGTERM', () => {
  writeFileSync(${JSON.stringify(daemonMarker)}, 'terminated\\n');
  process.exit(0);
});
process.stdout.write('READY\\n');
setInterval(() => {}, 1000);`,
        )}], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
daemon.stdout.once('data', () => {
  writeFileSync(process.env.HOME + '/daemon.pid', String(daemon.pid));
  process.exit(0);
});
`,
      );
      chmodSync(fakePnpm, 0o755);
      process.env.PATH = `${bin}:${originalPath ?? ''}`;
      try {
        await expect(
          runContainedVerification({
            disposable_root: disposable,
            runtime_root: runtime,
            phase: 'verify',
            pnpm_store_path: store,
            lockfile_sha256: createHash('sha256')
              .update(lockfile)
              .digest('hex'),
          }),
        ).resolves.toEqual({ status: 0, signal: null });
        expect(existsSync(daemonMarker)).toBe(true);
      } finally {
        process.env.PATH = originalPath;
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it('publishes immutable failed verification receipts', () => {
    const root = realpathSync(
      mkdtempSync(join(realpathSync(tmpdir()), 'fluo-canonical-receipt-')),
    );
    const laneId = 'lane-receipt-failure';
    const receiptRoot = resolve(root, laneId, 'issues', '3306');
    mkdirSync(receiptRoot, { recursive: true });
    const receipt = {
      version: 2,
      task_id: 'st_parent_failure',
      status: 1,
      result: 'fail',
    };

    try {
      publishCanonicalVerificationReceipt(
        root,
        laneId,
        3306,
        'st_parent_failure',
        receipt,
      );

      const receiptPath = resolve(
        receiptRoot,
        'canonical-verification',
        'st_parent_failure.json',
      );
      expect(JSON.parse(readFileSync(receiptPath, 'utf8'))).toEqual(receipt);
      expect(() =>
        publishCanonicalVerificationReceipt(
          root,
          laneId,
          3306,
          'st_parent_failure',
          receipt,
        ),
      ).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('serializes different issues through one repository lease', () => {
    const root = realpathSync(
      mkdtempSync(join(realpathSync(tmpdir()), 'fluo-global-verify-lease-')),
    );

    try {
      withGlobalCanonicalVerificationLease(
        root,
        'lane-first',
        3305,
        () => {
          expect(() =>
            withGlobalCanonicalVerificationLease(
              root,
              'lane-second',
              3306,
              () => undefined,
            ),
          ).toThrow(/already running/u);
        },
      );
      expect(
        withGlobalCanonicalVerificationLease(
          root,
          'lane-second',
          3306,
          () => 'released',
        ),
      ).toBe('released');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
