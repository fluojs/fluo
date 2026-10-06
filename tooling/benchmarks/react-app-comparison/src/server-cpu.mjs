import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const SERVER_CPU_METHOD = 'linux-server-pid-lifetime-single-cpu-v2';

function parseStat(raw, pid) {
  const end = raw.lastIndexOf(')');
  const fields = raw.slice(end + 2).trim().split(/\s+/u);
  const observedPid = Number(raw.slice(0, raw.indexOf(' ')));
  const [utime, stime, starttime] = [fields[11], fields[12], fields[19]].map(Number);
  if (end < 0 || observedPid !== pid || ![utime, stime, starttime].every((value) =>
    Number.isSafeInteger(value) && value >= 0)) throw new Error('invalid server CPU stat identity/counters');
  return { utime, stime, starttime };
}

export function replayServerCpu(raw) {
  if (raw.method !== SERVER_CPU_METHOD || !Number.isSafeInteger(raw.pid) || raw.pid <= 0) {
    throw new Error('invalid server CPU method/PID');
  }
  const counters = parseStat(raw.rawStat, raw.pid);
  const after = parseStat(raw.rawStatAfter, raw.pid);
  if (counters.starttime !== after.starttime || after.utime < counters.utime || after.stime < counters.stime) {
    throw new Error('server CPU birth/counter replacement');
  }
  const clkTck = Number(raw.rawClkTck.trim());
  const uptimeSeconds = Number(raw.rawUptime.trim().split(/\s+/u)[0]);
  const [displayCpuPercent, rssKiB] = raw.rawPs.trim().split(/\s+/u).map(Number);
  const lifetimeSeconds = uptimeSeconds - counters.starttime / clkTck;
  if (!Number.isSafeInteger(clkTck) || clkTck <= 0 || !Number.isFinite(uptimeSeconds)
    || lifetimeSeconds <= 0 || !Number.isFinite(displayCpuPercent) || displayCpuPercent < 0
    || !Number.isSafeInteger(rssKiB) || rssKiB < 0) throw new Error('invalid server CPU clock/ps');
  return { ...raw, ...counters, clkTck, uptimeSeconds, lifetimeSeconds,
    cpuPercent: (counters.utime + counters.stime) * 100 / clkTck / lifetimeSeconds,
    rssBytes: rssKiB * 1024,
    quantization: { cpuTickSeconds: 1 / clkTck, birthTickSeconds: 1 / clkTck,
      uptimeResolutionSeconds: 0.01,
      meaning: 'kernel tick and uptime quantization retained; unrounded arithmetic is not continuous-time precision' } };
}

export async function readServerCpu(pid, { read = (path) => readFile(path, 'utf8'), execute: run = execute } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('configured server CPU PID required');
  const rawStat = await read(`/proc/${pid}/stat`);
  const rawUptime = await read('/proc/uptime');
  const { stdout: rawClkTck } = await run('getconf', ['CLK_TCK']);
  const { stdout: rawPs } = await run('ps', ['-p', String(pid), '-o', '%cpu=', '-o', 'rss=']);
  const rawStatAfter = await read(`/proc/${pid}/stat`);
  return replayServerCpu({ method: SERVER_CPU_METHOD, pid, rawStat, rawStatAfter, rawUptime, rawClkTck, rawPs });
}
