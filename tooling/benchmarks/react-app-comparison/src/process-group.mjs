export async function stopOwnedProcess(child, { group = true, termMs = 2_000, killMs = 2_000 } = {}) {
  if (!child.pid) return;
  const target = group ? -child.pid : child.pid;
  const alive = () => {
    try {
      process.kill(target, 0);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  };
  const signal = (name) => {
    try {
      process.kill(target, name);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const waitForDeath = (duration) => new Promise((resolve) => {
    if (!alive()) { resolve(true); return; }
    const finish = (dead) => {
      clearInterval(probe);
      clearTimeout(limit);
      resolve(dead);
    };
    const probe = setInterval(() => {
      if (!alive()) finish(true);
    }, 25);
    const limit = setTimeout(() => finish(!alive()), duration);
  });
  if (!alive()) {
    console.log(`BENCH_PROCESS_REAPED pid=${child.pid} group=${group} escalated=false`);
    return;
  }
  signal('SIGTERM');
  const escalated = !await waitForDeath(termMs);
  if (escalated) {
    signal('SIGKILL');
    if (!await waitForDeath(killMs)) throw new Error(`owned ${group ? 'process group' : 'process'} ${child.pid} survived SIGKILL`);
  }
  if (alive()) throw new Error(`owned ${group ? 'process group' : 'process'} ${child.pid} remains live`);
  console.log(`BENCH_PROCESS_REAPED pid=${child.pid} group=${group} escalated=${escalated}`);
}
