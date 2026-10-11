import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
let clockTicks: Promise<number> | undefined;
export interface ProcessSample {
  readonly wallMs: number;
  readonly cpuTimeResolutionSeconds: number;
  readonly processes: readonly { readonly pid: number; readonly parent: number; readonly rssKiB: number; readonly cpuSeconds: number; readonly command: string }[];
}

export class ResourceMeasurementFailure extends Error {
  constructor(cause: unknown, readonly samples: readonly ProcessSample[]) {
    super('Server measurement failed', { cause });
    this.name = 'ResourceMeasurementFailure';
  }
}

export function cpuSeconds(value: string): number {
  const fields = value.split(':').map(Number);
  if (fields.some((field) => !Number.isFinite(field))) throw new Error(`Unsupported ps CPU time: ${value}`);
  return fields.reduce((total, field) => total * 60 + field, 0);
}

export function procCpuSeconds(value: string, ticksPerSecond: number): number {
  const end = value.lastIndexOf(')');
  const fields = value.slice(end + 2).trim().split(/\s+/);
  const user = Number(fields[11]);
  const system = Number(fields[12]);
  if (end < 0 || !Number.isSafeInteger(ticksPerSecond) || ticksPerSecond <= 0
    || !Number.isSafeInteger(user) || user < 0 || !Number.isSafeInteger(system) || system < 0) {
    throw new Error('Unsupported procfs CPU counter');
  }
  return (user + system) / ticksPerSecond;
}

export async function processTreeSample(rootPid: number): Promise<ProcessSample> {
  const frequency = process.platform === 'linux'
    ? await (clockTicks ??= execute('getconf', ['CLK_TCK']).then(({ stdout }) => {
      const value = Number(stdout.trim());
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Unsupported kernel CPU clock frequency');
      return value;
    }))
    : undefined;
  const output = (await execute('ps', ['-axo', 'pid=,ppid=,rss=,time=,command='])).stdout;
  const all = output.trim().split('\n').map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) throw new Error(`Unrecognized ps resource row: ${line}`);
    return { pid: Number(match[1]), parent: Number(match[2]), rssKiB: Number(match[3]), psTime: match[4], command: match[5] };
  });
  const pids = new Set([rootPid]);
  let previousSize = 0;
  while (previousSize !== pids.size) {
    previousSize = pids.size;
    for (const item of all) if (pids.has(item.parent)) pids.add(item.pid);
  }
  const selected = all.filter((item) => pids.has(item.pid));
  const processes = await Promise.all(selected.map(async ({ psTime, ...item }) => ({
    ...item,
    cpuSeconds: frequency === undefined ? cpuSeconds(psTime)
      : procCpuSeconds(await readFile(`/proc/${item.pid}/stat`, 'utf8'), frequency),
  })));
  if (!processes.some((item) => item.pid === rootPid)) throw new Error(`Server process ${rootPid} is not alive`);
  const cpuTimeResolutionSeconds = frequency === undefined
    ? Math.max(...selected.map(({ psTime }) => 10 ** -(psTime.split('.')[1]?.length ?? 0)))
    : 1 / frequency;
  return { wallMs: performance.now(), cpuTimeResolutionSeconds, processes };
}

export async function monitorServer<T>(rootPid: number, action: () => Promise<T>, samples: ProcessSample[] = []) {
  samples.push(await processTreeSample(rootPid));
  let pending = Promise.resolve();
  let failure: unknown;
  // Time is the measured behavior: this interval samples RSS during the run.
  const timer = setInterval(() => {
    pending = pending.then(async () => { samples.push(await processTreeSample(rootPid)); }).catch((error: unknown) => { failure = error; });
  }, 250);
  try {
    const value = await action();
    clearInterval(timer);
    await pending;
    if (failure !== undefined) throw failure;
    samples.push(await processTreeSample(rootPid));
    const first = samples[0];
    const last = samples[samples.length - 1];
    const firstByPid = new Map(first.processes.map((item) => [item.pid, item.cpuSeconds]));
    const accumulated = new Map<number, number>();
    for (const sample of samples) for (const item of sample.processes) {
      accumulated.set(item.pid, Math.max(accumulated.get(item.pid) ?? 0, item.cpuSeconds - (firstByPid.get(item.pid) ?? 0)));
    }
    const wallSeconds = (last.wallMs - first.wallMs) / 1_000;
    return {
      value,
      server: {
        subject: 'server-process-tree', rootPid,
        method: process.platform === 'linux' ? 'procfs-cpu-and-ps-250ms-rss-samples' : 'ps-cumulative-cpu-and-250ms-rss-samples',
        cpuTimeResolutionSeconds: Math.max(...samples.map((sample) => sample.cpuTimeResolutionSeconds)),
        wallSeconds, cpuSeconds: [...accumulated.values()].reduce((sum, cpu) => sum + cpu, 0),
        cpuCoreEquivalentPercent: [...accumulated.values()].reduce((sum, cpu) => sum + cpu, 0) / wallSeconds * 100,
        peakRssBytes: Math.max(...samples.map((sample) => sample.processes.reduce((sum, item) => sum + item.rssKiB * 1_024, 0))),
        samples,
        limitations: ['RSS is sampled, not an allocator high-water mark.', 'CPU counters have the recorded platform-dependent resolution; short smoke samples are not performance evidence.', 'Host descendants that exit between samples may be missed; workerd control processes are included.'],
      },
    };
  } catch (error) {
    throw new ResourceMeasurementFailure(error, samples);
  } finally {
    clearInterval(timer);
    await pending;
  }
}
