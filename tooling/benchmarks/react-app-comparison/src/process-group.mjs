const shutdowns = new WeakMap();

export function stopOwnedProcess(child, options = {}) {
  const existing = shutdowns.get(child);
  if (existing) return existing;
  const stopping = terminateOwnedProcess(child, options);
  shutdowns.set(child, stopping);
  void stopping.catch(() => shutdowns.delete(child));
  return stopping;
}

async function terminateOwnedProcess(child, { group = true, termMs = 2_000, killMs = 2_000 } = {}) {
  if (!child.pid) return;
  const target = group ? -child.pid : child.pid;
  const alive = () => {
    try {
      process.kill(target, 0);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      if (error.code === 'EPERM') return true;
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
  const waitForDeath = (duration) => new Promise((resolve, reject) => {
    if (!alive()) { resolve(true); return; }
    const finish = (dead, error) => {
      clearInterval(probe);
      clearTimeout(limit);
      if (error) reject(error);
      else resolve(dead);
    };
    const probe = setInterval(() => {
      try {
        if (!alive()) finish(true);
      } catch (error) {
        finish(false, error);
      }
    }, 25);
    const limit = setTimeout(() => {
      try {
        finish(!alive());
      } catch (error) {
        finish(false, error);
      }
    }, duration);
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
