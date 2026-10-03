import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Page } from '@playwright/test';

const execute = promisify(execFile);

/** RSS is OS process residency, not a JavaScript heap or a GC correctness verdict. */
export async function browserRSS() {
  try {
    const { stdout } = await execute('ps', ['-eo', 'pid=,ppid=,rss=,comm='], { timeout: 10_000 });
    const rows = stdout.trim().split('\n').map((line) => {
      const parts = line.trim().split(/\s+/u);
      return { pid: Number(parts[0]), parent: Number(parts[1]), rssBytes: Number(parts[2]) * 1024,
        command: parts.slice(3).join(' ') };
    });
    const descendants = new Set([process.pid]);
    // Traverse the finite process tree, not a timed state poll.
    for (let generation = 0; generation < rows.length; generation++) {
      const before = descendants.size;
      for (const row of rows) if (descendants.has(row.parent)) descendants.add(row.pid);
      if (descendants.size === before) break;
    }
    const browser = rows.filter((row) => descendants.has(row.pid)
      && /chrome|chromium|firefox|webkit|WebKitNetworkProcess|WebKitWebProcess/iu.test(row.command));
    return { supported: browser.length > 0, method: 'ps descendant RSS; shared pages may be counted repeatedly',
      processes: browser, rssBytes: browser.length === 0 ? null : browser.reduce((sum, row) => sum + row.rssBytes, 0) };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { supported: false, method: 'ps unavailable', rssBytes: null, reason: error.message, processes: [] };
  }
}

/** Return scalars only; observers, promises, port objects and module caches are excluded. */
export async function resources(page: Page) {
  return page.evaluate(() => {
    const state = Reflect.get(window, '__longSession');
    if (state === undefined) throw new Error('Missing test observer');
    return {
      document: state.document, id: state.id, mounts: state.mounts, cleanups: state.cleanups,
      ports: state.ports, actualInstanceRetained: state.original?.deref() !== undefined
        && state.original.deref() === state.instance?.deref(),
      closedBeforeCleanup: state.closedBeforeCleanup,
      globalListeners: state.globalListeners, sockets: state.sockets,
      harnessObservers: state.observers, unhandled: state.unhandled,
      interactionOwners: document.querySelectorAll('form[data-enhanced="true"]').length,
      pendingInteractions: [...document.querySelectorAll('[data-form-state]')]
        .filter((element) => /pending/u.test(element.textContent ?? '')).length,
      pendingNavigation: [...document.querySelectorAll('nav p, [aria-label="Navigation status"]')]
        .some((element) => /navigating|refreshing/u.test(element.textContent ?? '')),
      url: location.pathname + location.search, title: document.title,
    };
  });
}
