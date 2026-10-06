import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { installInitialReadiness, waitForInitialReadiness } from '../src/initial-readiness.mjs';

async function observer(existingHook, options) {
  let install;
  let arguments_;
  let deadline;
  await installInitialReadiness({ addInitScript(fn, args) { install = fn; arguments_ = args; } }, options);
  const listeners = new Map();
  const window = {
    __REACT_DEVTOOLS_GLOBAL_HOOK__: existingHook,
    addEventListener(name, callback) { listeners.set(name, callback); },
  };
  runInNewContext(`(${install.toString()})(arguments_)`, {
    window, performance, arguments_,
    setTimeout(callback, ms) { deadline = ms; return setTimeout(callback, ms); }, clearTimeout,
    document: { querySelectorAll() { return []; } },
  });
  return { window, load: listeners.get('load'), hook: window.__REACT_DEVTOOLS_GLOBAL_HOOK__, deadline };
}

const root = () => ({
  pendingLanes: 0,
  current: {
    tag: 3, flags: 0, subtreeFlags: 0, child: null, sibling: null,
    memoizedState: { isDehydrated: false, element: {} },
  },
});

test('preserves an installed DevTools hook identity, renderer ID, callbacks and receiver', async () => {
  const calls = [];
  const existing = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      calls.push(['inject', this, renderer.version]);
      this.renderers.set(77, renderer);
      return 77;
    },
    onCommitFiberRoot(id) { calls.push(['commit', this, id]); },
    onPostCommitFiberRoot(id) { calls.push(['post', this, id]); },
    onCommitFiberUnmount() {},
    rendererData: new Map(),
  };
  const state = await observer(existing);
  assert.equal(state.hook, existing);
  const renderer = { version: '19.2.8', bundleType: 1, setRefreshHandler() {} };
  const registry = existing.renderers;
  assert.equal(state.hook.inject(renderer), 77);
  assert.equal(state.hook.renderers, registry);
  assert.equal(registry.get(77), renderer);
  const actualRoot = root();
  actualRoot.current.subtreeFlags = 2048;
  state.load();
  state.hook.onCommitFiberRoot(77, actualRoot);
  assert.equal(state.window.__benchmarkInitialReadiness.completedAt, null);
  state.hook.onPostCommitFiberRoot(77, actualRoot);
  const evidence = await state.window.__benchmarkInitialCompletion;
  assert.equal(evidence.error, null);
  assert.equal(evidence.events.at(-1).event, 'post-passive');
  assert.deepEqual(calls.map(([name]) => name), ['inject', 'commit', 'post']);
  assert.ok(calls.every(([, receiver]) => receiver === existing));
});

test('synthetic hook exposes real renderer objects for Fast Refresh and both frozen dev versions', async () => {
  for (const version of ['19.2.8', '19.3.0-canary-cbb046ab-20260731']) {
    const state = await observer(undefined, { timeoutMs: 60_000 });
    let refreshHandler;
    const renderer = { version, bundleType: 1, setRefreshHandler(handler) { refreshHandler = handler; } };
    const id = state.hook.inject(renderer);
    assert.equal(state.deadline, 60_000);
    assert.equal(state.hook.renderers.get(id), renderer);
    const handler = () => {};
    // This is the renderer-registry protocol used by react-refresh's hook injection.
    state.hook.renderers.forEach((registered) => { registered.setRefreshHandler(handler); });
    assert.equal(refreshHandler, handler);
    state.hook.onScheduleFiberRoot(id, root());
    state.load();
    state.hook.onCommitFiberRoot(id, root());
    const evidence = await state.window.__benchmarkInitialCompletion;
    assert.equal(evidence.error, null);
    assert.equal(evidence.renderers[0].bundleType, 1);
    assert.equal(evidence.renderers[0].version, version);
  }
});

test('unknown production renderer fails closed without falling back to document load', async () => {
  const state = await observer();
  assert.equal(state.deadline, 10_000);
  const id = state.hook.inject({ version: 'unsupported' });
  state.hook.onCommitFiberRoot(id, root());
  state.load();
  const evidence = await state.window.__benchmarkInitialCompletion;
  await assert.rejects(waitForInitialReadiness({ evaluate() { return evidence; } }), /unsupported renderer/u);
  assert.equal(evidence.completedAt, null);
});
