import { createHash, randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const owners = new WeakSet();
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A fresh root belongs to one capture; nested runners claim their own children. */
export function claimEvidenceRoot(directory) {
  const root = resolve(directory);
  mkdirSync(dirname(root), { recursive: true });
  try { mkdirSync(root); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (readdirSync(root).length !== 0) throw new TypeError(`Use a fresh evidence root: ${root}`);
  try {
    writeFileSync(resolve(root, '.evidence-owner.json'), `${JSON.stringify({ owner: randomUUID() })}\n`, { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw new TypeError(`Conflicting evidence root: ${root}`);
    throw error;
  }
  const owner = Object.freeze({ root: realpathSync(root) });
  owners.add(owner);
  return owner;
}

/** Persist full raw bytes independently of a bounded terminal reference. */
export function createCommandEvidence(owner, label, command, options, emit = (text) => process.stdout.write(text)) {
  if (!owners.has(owner)) throw new TypeError('Command evidence requires its fresh evidence root owner');
  if (!/^[a-zA-Z0-9_-]+$/u.test(label)) throw new TypeError('Invalid command evidence label');
  const paths = Object.fromEntries(['stdout', 'stderr', 'log'].map((name) =>
    [name, resolve(owner.root, `${label}.${name === 'log' ? 'log' : `${name}.raw.log`}`)]));
  const descriptors = Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, openSync(path, 'wx')]));
  const started = performance.now();
  const reference = (path) => {
    const bytes = readFileSync(path);
    return { path, bytes: bytes.length, sha256: digest(bytes) };
  };
  const write = (descriptor, chunk) => {
    let offset = 0;
    while (offset < chunk.length) offset += writeSync(descriptor, chunk, offset);
  };
  const subscriptions = [];
  return {
    attach(child) {
      for (const name of ['stdout', 'stderr']) {
        const stream = child[name];
        const onData = (chunk) => {
          write(descriptors[name], chunk);
          write(descriptors.log, chunk);
        };
        stream.on('data', onData);
        subscriptions.push({ stream, onData });
      }
    },
    finish(outcome) {
      for (const { stream, onData } of subscriptions) stream.off('data', onData);
      for (const descriptor of Object.values(descriptors)) closeSync(descriptor);
      const receipt = {
        version: 1, complete: true, executable: command.executable, args: command.args,
        cwd: resolve(options.cwd ?? process.cwd()), env: command.env ?? {},
        exit_code: outcome.exitCode, signal: outcome.signal, closed: outcome.closed,
        cancelled: outcome.cancelled === true, forced: outcome.forced === true,
        ...(outcome.error ? { error: {
          name: outcome.error.name, message: outcome.error.message, code: outcome.error.code,
          errno: outcome.error.errno, syscall: outcome.error.syscall, path: outcome.error.path,
          spawnargs: outcome.error.spawnargs,
        } } : {}),
        duration_ms: performance.now() - started,
        ...Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, reference(path)])),
      };
      const path = resolve(owner.root, `${label}.command-receipt.json`);
      writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
      const evidence = { receipt: reference(path), stdout: receipt.stdout, stderr: receipt.stderr, log: receipt.log };
      emit(`${JSON.stringify({ kind: 'command-evidence', receipt: evidence.receipt,
        exit_code: receipt.exit_code, signal: receipt.signal, closed: receipt.closed,
        cancelled: receipt.cancelled, duration_ms: receipt.duration_ms })}\n`);
      return evidence;
    },
  };
}
