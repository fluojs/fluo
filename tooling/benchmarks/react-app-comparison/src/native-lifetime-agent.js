// ABI and offsets are supplied only after host ELF/hash/symbol authentication.
// Request events stay in this process until an explicit drain, never send().
let configured = false;
let runId;
let processBirth;
let sequence = 0;
let resourceSerial = 0;
let loaderSerial = 0;
let callSerial = 0;
let dropped = 0;
const events = [];
const resources = new Map();
const loaders = new Map();
const observers = new Map();
const calls = new Map();
const hooks = [];
const clock = new NativeFunction(Module.getGlobalExportByName('clock_gettime'), 'int', ['int', 'pointer']);
const timespec = Memory.alloc(16);

function now() {
  if (clock(1, timespec) !== 0) throw new Error('CLOCK_MONOTONIC failed');
  return (BigInt(timespec.readS64().toString()) * 1000000000n
    + BigInt(timespec.add(8).readS64().toString())).toString();
}
function record(event, fields = {}) {
  if (events.length >= 500000) { dropped++; return; }
  events.push({ event, runId, pid: Process.id, processBirth, seq: ++sequence, ns: now(), ...fields });
}
rpc.exports = {
  initializeShutdown(config) {
    if (configured) throw new Error('agent already configured');
    configured = true;
    const module = Process.enumerateModules()[0];
    if (module.path !== config.loadedPath || Process.arch !== 'arm64') throw new Error('shutdown module mismatch');
    const stack = new Map();
    const emit = (event, fields) => {
      if (++sequence > 4096) throw new Error('shutdown event capacity exceeded');
      send({ event, runId: config.runId, pid: Process.id, processBirth: config.processBirth,
        seq: sequence, ns: now(), ...fields });
    };
    const enter = (context, event, fields) => {
      const nested = stack.get(context.threadId) ?? [];
      context.binding = { call: ++callSerial, parent: nested.at(-1) ?? null, thread: context.threadId, ...fields };
      nested.push(context.binding.call);
      stack.set(context.threadId, nested);
      emit(`${event}-enter`, context.binding);
    };
    const leave = (context, event, fields) => {
      const nested = stack.get(context.threadId);
      if (nested?.pop() !== context.binding.call) throw new Error('shutdown call stack mismatch');
      if (!nested.length) stack.delete(context.threadId);
      emit(`${event}-return`, { ...context.binding, ...fields });
    };
    for (const hook of config.hooks) {
      const address = module.base.add(hook.offset);
      if (!Process.findRangeByAddress(address)?.protection.includes('x')) throw new Error('shutdown hook outside executable mapping');
      hooks.push(Interceptor.attach(address, {
        onEnter(args) {
          enter(this, `shutdown-${hook.event}`, hook.event === 'terminate'
            ? { exitCode: args[1].toInt32(), wait: args[2].toInt32() } : {});
        },
        onLeave(retval) {
          leave(this, `shutdown-${hook.event}`, hook.event === 'terminate' ? { result: retval.toInt32() } : {});
        },
      }));
    }
    hooks.push(Interceptor.attach(Module.getGlobalExportByName('kill'), {
      onEnter(args) {
        const pid = args[0].toInt32();
        let target = { pid, missing: true };
        if (pid > 0) {
          try {
            const raw = File.readAllText(`/proc/${pid}/stat`);
            const fields = raw.slice(raw.lastIndexOf(')') + 1).trim().split(/\s+/u);
            target = { pid, processBirth: `${pid}:${fields[19]}`, state: fields[0] };
          } catch (error) { target.error = String(error); }
        }
        enter(this, 'shutdown-signal', { signal: args[1].toInt32(), target });
      },
      onLeave(retval) { leave(this, 'shutdown-signal', { result: retval.toInt32() }); },
    }));
    Interceptor.flush();
    emit('shutdown-ready', {});
    return true;
  },
  initialize(config) {
    if (configured) throw new Error('agent already configured');
    configured = true;
    runId = config.runId;
    processBirth = config.processBirth;
    const module = Process.enumerateModules()[0];
    if (Process.platform !== 'linux' || Process.arch !== 'arm64' || Process.pointerSize !== 8
      || module.name !== 'headless_shell' || module.path !== config.loadedPath) throw new Error('loaded module ABI/path mismatch');
    for (const hook of config.hooks) {
      let callbacks;
      switch (hook.event) {
        case 'resource':
          callbacks = {
            onEnter(args) {
              this.resource = args[0].toString();
              this.resourceBirth = ++resourceSerial;
              resources.set(this.resource, this.resourceBirth);
            },
            onLeave() {
              record('resource-birth', { resource: this.resource, resourceBirth: this.resourceBirth });
            },
          };
          break;
        case 'loader':
          callbacks = {
            onEnter(args) {
              this.loader = args[0].toString();
              this.binding = { loader: this.loader, loaderBirth: ++loaderSerial,
                resource: args[3].toString(), resourceBirth: resources.get(args[3].toString()) ?? null };
              loaders.set(this.loader, this.binding);
            },
            onLeave() { record('loader-birth', this.binding); },
          };
          break;
        case 'observer':
          callbacks = {
            onEnter(args) {
              this.previous = observers.get(this.threadId);
              const resource = args[6].toString();
              observers.set(this.threadId, { resource, resourceBirth: resources.get(resource) ?? null,
                observerCall: ++callSerial });
            },
            onLeave() {
              if (this.previous) observers.set(this.threadId, this.previous);
              else observers.delete(this.threadId);
            },
          };
          break;
        case 'identifier':
          callbacks = {
            onEnter(args) {
              const binding = observers.get(this.threadId);
              if (binding) record('identifier', { ...binding, identifier: BigInt(args[1].toString()).toString() });
            },
          };
          break;
        case 'cancel':
        case 'error': {
          const event = hook.event;
          callbacks = {
            onEnter(args) {
              const stack = calls.get(this.threadId) ?? [];
              this.call = ++callSerial;
              this.parent = stack.at(-1) ?? null;
              this.binding = { ...(loaders.get(args[0].toString()) ?? {}), loader: args[0].toString(),
                call: this.call, parent: this.parent, thread: this.threadId };
              stack.push(this.call);
              calls.set(this.threadId, stack);
              record(`${event}-enter`, this.binding);
            },
            onLeave() {
              const stack = calls.get(this.threadId);
              if (stack?.pop() !== this.call) throw new Error('native call stack mismatch');
              if (!stack.length) calls.delete(this.threadId);
              record(`${event}-return`, { ...this.binding, normal: true });
            },
          };
          break;
        }
        default: throw new Error('unknown native hook');
      }
      const address = module.base.add(hook.offset);
      const range = Process.findRangeByAddress(address);
      if (!range?.protection.includes('x')) throw new Error('hook outside executable mapping');
      hooks.push(Interceptor.attach(address, callbacks));
    }
    Interceptor.flush();
    record('hooks-ready', { hooks: hooks.length });
    return { loadedPath: module.path, base: module.base.toString(), arch: Process.arch,
      pointerSize: Process.pointerSize, hooks: hooks.length, readyNs: events[0].ns };
  },
  drain() {
    return { events: events.splice(0), dropped, sequence, ns: now(), complete: calls.size === 0 };
  },
  stop() {
    for (const hook of hooks) hook.detach();
    Interceptor.flush();
    return true;
  },
};
