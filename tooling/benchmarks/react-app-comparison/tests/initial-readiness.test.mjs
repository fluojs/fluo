import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { installInitialReadiness, waitForInitialReadiness } from '../src/initial-readiness.mjs';

async function observer(existingHook) {
  let install;
  await installInitialReadiness({ addInitScript(fn) { install = fn; } });
  const listeners = new Map();
  const window = {
    __REACT_DEVTOOLS_GLOBAL_HOOK__: existingHook,
    addEventListener(name, callback) { listeners.set(name, callback); },
  };
  runInNewContext(`(${install.toString()})()`, {
    window, performance, setTimeout, clearTimeout,
    document: { querySelectorAll() { return []; } },
  });
  return { window, load: listeners.get('load'), hook: window.__REACT_DEVTOOLS_GLOBAL_HOOK__ };
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
    inject(renderer) { calls.push(['inject', this, renderer.version]); return 77; },
    onCommitFiberRoot(id) { calls.push(['commit', this, id]); },
    onPostCommitFiberRoot(id) { calls.push(['post', this, id]); },
    onCommitFiberUnmount() {},
    rendererData: new Map(),
  };
  const state = await observer(existing);
  assert.equal(state.hook, existing);
  assert.equal(state.hook.inject({ version: '19.2.8' }), 77);
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

test('unknown production renderer fails closed without falling back to document load', async () => {
  const state = await observer();
  const id = state.hook.inject({ version: 'unsupported' });
  state.hook.onCommitFiberRoot(id, root());
  state.load();
  const evidence = await state.window.__benchmarkInitialCompletion;
  await assert.rejects(waitForInitialReadiness({ evaluate() { return evidence; } }), /unsupported renderer/u);
  assert.equal(evidence.completedAt, null);
});
