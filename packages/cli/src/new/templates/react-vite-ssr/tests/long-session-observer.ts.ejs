import type { Page } from '@playwright/test';

/** Installed only by the reliability tests, before hydration. No public diagnostic API. */
export async function installObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const closed = new WeakSet<MessagePort>();
    const close = MessagePort.prototype.close;
    MessagePort.prototype.close = function () { close.call(this); closed.add(this); };
    let mounted: () => void = () => { throw new Error('Missing resource mount subscription'); };
    const ready = new Promise<void>((resolve) => { mounted = resolve; });
    const state: {
      document: string; mounts: number; cleanups: number; ports: number; id: string;
      instance: WeakRef<MessagePort> | null; original: WeakRef<MessagePort> | null;
      closedBeforeCleanup: boolean; globalListeners: number; observers: number;
      sockets: number; unhandled: number; ready: Promise<void>;
    } = {
      document: crypto.randomUUID(), mounts: 0, cleanups: 0, ports: 0,
      id: '', instance: null, original: null, closedBeforeCleanup: true,
      globalListeners: 0, observers: 0, sockets: 0, unhandled: 0, ready,
    };
    Reflect.set(window, '__longSession', state);
    document.addEventListener('fluo-resource', (event) => {
      if (!(event instanceof CustomEvent)) throw new Error('Missing resource event');
      const { phase, id, ports } = event.detail;
      if (phase === 'mount') {
        state.mounts++; state.ports += ports.length; state.id = id;
        state.instance = new WeakRef(ports[0]);
        state.original ??= state.instance;
        mounted();
      } else if (phase === 'cleanup') {
        state.cleanups++; state.ports -= ports.length;
        state.closedBeforeCleanup &&= ports.every((port: MessagePort) => closed.has(port));
      }
    });
    window.addEventListener('unhandledrejection', () => { state.unhandled++; });
    // Only persistent window/document targets are counted. React's delegated element
    // handlers and native module caches are not mislabeled as product subscriptions.
    type Entry = { readonly wrapped: EventListener; readonly forget: () => void };
    const listeners = new WeakMap<EventTarget, Map<string, Map<EventListenerOrEventListenerObject, Entry>>>();
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, callback, options) {
      if ((this === window || this === document) && callback !== null) {
        const key = `${type}:${typeof options === 'boolean' ? options : options?.capture === true}`;
        const target = listeners.get(this) ?? new Map();
        const registered = target.get(key) ?? new Map<EventListenerOrEventListenerObject, Entry>();
        const existing = registered.get(callback);
        if (existing !== undefined) return add.call(this, type, existing.wrapped, options);
        const signal = typeof options === 'object' ? options.signal : undefined;
        if (signal?.aborted) return add.call(this, type, callback, options);
        const once = typeof options === 'object' && options.once === true;
        const forget = () => {
          if (registered.delete(callback)) state.globalListeners--;
          if (registered.size === 0) target.delete(key);
          signal?.removeEventListener('abort', forget);
        };
        const wrapped: EventListener = function (this: EventTarget, event) {
          if (once) forget();
          if (typeof callback === 'function') callback.call(this, event);
          else callback.handleEvent(event);
        };
        registered.set(callback, { wrapped, forget });
        state.globalListeners++;
        target.set(key, registered); listeners.set(this, target);
        signal?.addEventListener('abort', forget, { once: true });
        return add.call(this, type, wrapped, options);
      }
      add.call(this, type, callback, options);
    };
    EventTarget.prototype.removeEventListener = function (type, callback, options) {
      const key = `${type}:${typeof options === 'boolean' ? options : options?.capture === true}`;
      const entry = callback === null ? undefined : listeners.get(this)?.get(key)?.get(callback);
      if (entry !== undefined) {
        entry.forget();
        return remove.call(this, type, entry.wrapped, options);
      }
      remove.call(this, type, callback, options);
    };
    // Weak references above do not keep a cleaned resource alive. This counter
    // observes real socket close, rather than assuming production has zero sockets.
    const NativeSocket = WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        state.sockets++;
        this.addEventListener('close', () => { state.sockets--; }, { once: true });
      }
    };
  });
}

/** Subscribe before an action; the observer is removed on success and deadline. */
export async function watchText(page: Page, selector: string, expected: string): Promise<string> {
  const key = `__longSignal_${crypto.randomUUID()}`;
  await page.evaluate(({ selector, expected, key }) => {
    const state = Reflect.get(window, '__longSession');
    Reflect.set(window, key, new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (![...document.querySelectorAll(selector)].some((element) => element.textContent?.includes(expected))) return;
        observer.disconnect(); state.observers--; clearTimeout(deadline); resolve();
      });
      const deadline = setTimeout(() => {
        observer.disconnect(); state.observers--; reject(new Error(`Missing ${selector}: ${expected}`));
      }, 10_000);
      state.observers++;
      observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    }));
  }, { selector, expected, key });
  return key;
}

export async function settled(page: Page, key: string): Promise<void> {
  await page.evaluate(async (key) => {
    const signal: unknown = Reflect.get(window, key);
    if (!(signal instanceof Promise)) throw new Error('Unexpected document boundary');
    try { await signal; } finally { Reflect.deleteProperty(window, key); }
  }, key);
}

/** An exact instance/sequence acknowledgement, not a label-only identity assertion. */
export async function acknowledge(page: Page, sequence: number): Promise<string> {
  const id: string = await page.evaluate(async () => {
    const state = Reflect.get(window, '__longSession');
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([state.ready, new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error('Resource did not mount')), 10_000);
      })]);
      return state.id;
    } finally { clearTimeout(deadline); }
  });
  const signal = await watchText(page, '[aria-label="Resource acknowledgement"]', `${id}:${sequence}:ack`);
  await page.getByRole('button', { name: 'Probe shell resource', exact: true }).click();
  await settled(page, signal);
  const ack = await page.getByLabel('Resource acknowledgement').textContent();
  if (ack !== `${id}:${sequence}:ack`) throw new Error(`Wrong MessageChannel acknowledgement: ${ack}`);
  return id;
}
