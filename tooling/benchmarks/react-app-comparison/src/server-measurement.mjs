import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readMeasurementReceipt } from './run-gate.mjs';
import { stopOwnedProcess } from './process-group.mjs';

export async function runServerMeasurement(configPath, receiptPath,
  measurementScript = fileURLToPath(new URL('./measure.mjs', import.meta.url)),
  { signal } = {}) {
  let exitCode;
  let child;
  let onAbort;
  signal?.throwIfAborted();
  try {
    const receipt = await readMeasurementReceipt(() => new Promise((resolve, reject) => {
      child = spawn(process.execPath, [measurementScript,
        '--config', configPath, '--output', receiptPath], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        stdio: 'inherit',
        detached: true,
      });
      onAbort = () => {
        void stopOwnedProcess(child).then(() => reject(signal.reason), reject);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      child.once('error', reject);
      child.once('exit', (code, exitSignal) => {
        exitCode = code;
        if (signal?.aborted) reject(signal.reason);
        else if (code === 0) resolve();
        else reject(Object.assign(new Error(`measure.mjs exited ${code ?? exitSignal}`), { code }));
      });
    }), receiptPath);
    signal?.throwIfAborted();
    return { receipt, exitCode };
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    if (child) await stopOwnedProcess(child);
  }
}
