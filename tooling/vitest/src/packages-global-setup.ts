import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const buildClosureScript = fileURLToPath(new URL('../../scripts/run-workspace-build-closure.mjs', import.meta.url));

export default function preparePackagesProjectEmittedArtifacts() {
  execFileSync(process.execPath, [buildClosureScript, '@fluojs/terminus'], {
    cwd: repoRoot,
    killSignal: 'SIGTERM',
    stdio: 'inherit',
    timeout: 60_000,
  });
}
