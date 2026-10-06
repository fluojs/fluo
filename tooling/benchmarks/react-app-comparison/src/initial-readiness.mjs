// Diagnostic Fiber fields are supported only for these frozen production renderers.
// This is not a public React readiness API.
export async function installInitialReadiness(page) {
  await page.addInitScript(() => {
    const supported = ['19.2.8', '19.3.0-canary-cbb046ab-20260731'];
    const roots = new Map();
    const renderers = new Map();
    const evidence = {
      method: 'react-initial-completion-v1', installedAt: performance.now(),
      renderers: [], events: [], loadAt: null, completedAt: null,
    };
    window.__benchmarkInitialReadiness = evidence;
    let finish;
    let completed = false;
    window.__benchmarkInitialCompletion = new Promise((resolve) => { finish = resolve; });
    const timeout = setTimeout(() => settle('initial React completion timeout'), 10_000);
    function settle(error) {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      evidence.error = error ?? null;
      if (!error) evidence.completedAt = performance.now();
      finish(evidence);
    }
    function snapshot(id, root, event, didError = false) {
      if (completed) return;
      const fiber = root.current;
      let suspensePending = 0;
      function visit(node) {
        if (!node) return;
        // Any fallback or dehydrated Suspense state is unfinished, not just the root.
        if (node.tag === 13 && node.memoizedState !== null) suspensePending++;
        visit(node.child);
        visit(node.sibling);
      }
      visit(fiber);
      const passivePending = event === 'commit'
        && ((fiber.flags | fiber.subtreeFlags) & 10256) !== 0;
      const state = {
        id, event, at: performance.now(), version: renderers.get(id),
        isDehydrated: fiber.memoizedState?.isDehydrated,
        hasElement: Boolean(fiber.memoizedState?.element),
        pendingLanes: root.pendingLanes, suspensePending, passivePending, didError,
      };
      roots.set(root, state);
      evidence.events.push(state);
      if (didError) settle('initial React completion reported a failed commit');
      check();
    }
    function check() {
      if (completed || evidence.loadAt === null || roots.size === 0) return;
      for (const state of roots.values()) {
        if (!supported.includes(state.version)) {
          settle(`initial React completion unsupported renderer: ${state.version}`);
          return;
        }
        if (state.isDehydrated !== false || !state.hasElement
          || state.pendingLanes !== 0 || state.suspensePending !== 0 || state.passivePending) return;
      }
      evidence.markers = [...document.querySelectorAll('[data-benchmark-hydrated]')]
        .map((node) => ({ tag: node.tagName, value: node.getAttribute('data-benchmark-hydrated') }));
      // Existing leaf-effect markers are corroboration, never a replacement for Fiber.
      if (evidence.markers.some((marker) => marker.value !== 'true')) return;
      settle();
    }
    const existing = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const hook = existing ?? {
      supportsFiber: true,
      inject() { return renderers.size + 1; },
      onCommitFiberUnmount() {},
    };
    evidence.existingHook = Boolean(existing);
    for (const name of ['inject', 'onCommitFiberRoot', 'onPostCommitFiberRoot']) {
      const original = hook[name];
      hook[name] = function (...args) {
        const result = original?.apply(this, args);
        if (name === 'inject') {
          renderers.set(result, args[0].version);
          evidence.renderers.push({ id: result, version: args[0].version });
        } else {
          snapshot(args[0], args[1], name === 'onCommitFiberRoot' ? 'commit' : 'post-passive', args[3]);
        }
        return result;
      };
    }
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
    window.addEventListener('load', () => {
      evidence.loadAt = performance.now();
      check();
    }, { once: true });
  });
}

export async function waitForInitialReadiness(page) {
  const evidence = await page.evaluate(() => window.__benchmarkInitialCompletion);
  if (!evidence || evidence.error) {
    throw new Error(evidence?.error ?? 'initial React completion observer unavailable', { cause: evidence });
  }
  return evidence;
}
