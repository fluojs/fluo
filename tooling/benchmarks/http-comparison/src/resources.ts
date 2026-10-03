import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export interface ProcessSample {
  readonly wallMs: number;
  readonly processes: readonly { readonly pid: number; readonly parent: number; readonly rssKiB: number; readonly cpuSeconds: number; readonly command: string }[];
}

export function cpuSeconds(value: string): number {
  const fields = value.split(':').map(Number);
  if (fields.some((field) => !Number.isFinite(field))) throw new Error(`Unsupported ps CPU time: ${value}`);
  return fields.reduce((total, field) => total * 60 + field, 0);
}

export async function processTreeSample(rootPid: number): Promise<ProcessSample> {
  const output = (await execute('ps', ['-axo', 'pid=,ppid=,rss=,time=,command='])).stdout;
  const all = output.trim().split('\n').map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) throw new Error(`Unrecognized ps resource row: ${line}`);
    return { pid: Number(match[1]), parent: Number(match[2]), rssKiB: Number(match[3]), cpuSeconds: cpuSeconds(match[4]), command: match[5] };
  });
  const pids = new Set([rootPid]);
  let previousSize = 0;
  while (previousSize !== pids.size) {
    previousSize = pids.size;
    for (const item of all) if (pids.has(item.parent)) pids.add(item.pid);
  }
  const processes = all.filter((item) => pids.has(item.pid));
  if (!processes.some((item) => item.pid === rootPid)) throw new Error(`Server process ${rootPid} is not alive`);
  return { wallMs: performance.now(), processes };
}

export async function monitorServer<T>(rootPid: number, action: () => Promise<T>) {
  const samples: ProcessSample[] = [await processTreeSample(rootPid)];
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
        subject: 'server-process-tree', rootPid, method: 'ps-cumulative-cpu-and-250ms-rss-samples',
        wallSeconds, cpuSeconds: [...accumulated.values()].reduce((sum, cpu) => sum + cpu, 0),
        cpuCoreEquivalentPercent: [...accumulated.values()].reduce((sum, cpu) => sum + cpu, 0) / wallSeconds * 100,
        peakRssBytes: Math.max(...samples.map((sample) => sample.processes.reduce((sum, item) => sum + item.rssKiB * 1_024, 0))),
        samples,
        limitations: ['RSS is sampled, not an allocator high-water mark.', 'ps CPU time has platform-dependent precision; short smoke samples are not performance evidence.', 'Host descendants that exit between samples may be missed; workerd control processes are included.'],
      },
    };
  } finally {
    clearInterval(timer);
    await pending;
  }
}
