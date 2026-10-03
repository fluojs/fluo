// ABI and offsets are supplied only after host ELF/hash/symbol authentication.
// Request records are release-published to a host-owned memfd, never send().
let configured = false;
let runId;
let processBirth;
let sequence = 0;
let resourceSerial = 0;
let loaderSerial = 0;
let callSerial = 0;
let journal;
let native;
let configuration;
let readyNs;
let parentConfiguration;
const parentTargets = new Map();
const bridges = [];
const contexts = new Map();
const eventNames = ['hooks-ready', 'resource-birth', 'loader-birth', 'identifier',
  'cancel-enter', 'error-enter', 'error-return', 'cancel-return'];
const fieldNames = ['resource', 'resourceBirth', 'loader', 'loaderBirth', 'identifier',
  'observerCall', 'call', 'parent', 'thread', 'normal', 'hooks'];
const resources = new Map();
const loaders = new Map();
const observers = new Map();
const calls = new Map();
const hooks = [];
const clock = new NativeFunction(Module.getGlobalExportByName('clock_gettime'), 'int',
  ['int', 'pointer'], { scheduling: 'exclusive' });
const timespec = Memory.alloc(16);

function now() {
  if (clock(1, timespec) !== 0) throw new Error('CLOCK_MONOTONIC failed');
  return (BigInt(timespec.readS64().toString()) * 1000000000n
    + BigInt(timespec.add(8).readS64().toString())).toString();
}
function record(event, fields = {}) {
  const payload = Memory.alloc(124);
  const timestamp = now();
  payload.writeU32(eventNames.indexOf(event) + 1);
  payload.add(4).writeU64(uint64(timestamp));
  let mask = 0;
  fieldNames.forEach((field, index) => {
    if (Object.hasOwn(fields, field)) {
      mask |= 1 << index;
      payload.add(12 + index * 8).writeU64(uint64(String(fields[field] === null ? 0
        : typeof fields[field] === 'boolean' ? Number(fields[field]) : fields[field])));
    }
  });
  payload.add(100).writeU32(mask);
  native.publish(payload);
  if (event === 'hooks-ready') readyNs = timestamp;
}

function createJournal(config) {
  // AArch64 LDAR/STLR and LDAXR/STLXR are the native acquire/release
  // primitives. No JS write publishes a commit marker or callback state.
  const code = Memory.alloc(Process.pageSize);
  Memory.patchCode(code, 148, (address) => {
    const writer = new Arm64Writer(address, { pc: code });
    writer.putInstruction(0x889ffc01); // stlr w1,[x0]
    writer.putInstruction(0xd65f03c0); // ret
    for (let offset = 8; offset < 64; offset += 4) writer.putNop();
    writer.putInstruction(0x88dffc00); // ldar w0,[x0]
    writer.putInstruction(0xd65f03c0);
    for (let offset = 72; offset < 128; offset += 4) writer.putNop();
    for (const instruction of [0x885ffc02, 0x0b010042, 0x8803fc02, 0x35ffffa3, 0xd65f03c0]) {
      writer.putInstruction(instruction);
    }
    writer.flush();
  });
  if (!Memory.protect(code, Process.pageSize, 'r-x')) throw new Error('native publication primitive unavailable');
  const memfd = new NativeFunction(Module.getGlobalExportByName('memfd_create'), 'int', ['pointer', 'uint']);
  const truncate = new NativeFunction(Module.getGlobalExportByName('ftruncate'), 'int', ['int', 'int64']);
  const mmap = new NativeFunction(Module.getGlobalExportByName('mmap'), 'pointer',
    ['pointer', 'uint64', 'int', 'int', 'int', 'int64']);
  const size = 512 + 500000 * 128;
  const fd = memfd(Memory.allocUtf8String('fluo-native-lifetime-v2'), 1);
  if (fd < 0 || truncate(fd, size) !== 0) throw new Error('native journal allocation failed');
  journal = mmap(ptr(0), size, 3, 1, fd, 0);
  if (journal.equals(ptr(-1))) throw new Error('native journal mapping failed');
  [0x4e4c4a32, 2, 500000, 128, 512, Process.id, config.execEpoch].forEach((value, index) =>
    journal.add(index * 4).writeU32(value));
  if (config.runId.length >= 128 || config.processBirth.length >= 128) throw new Error('journal identity too long');
  journal.add(64).writeUtf8String(config.runId);
  journal.add(192).writeUtf8String(config.processBirth);
  const module = new CModule(`
    #include <gum/guminterceptor.h>
    #include <string.h>
    typedef unsigned int U32;
    extern unsigned char journal[];
    extern void release_store(U32 *, U32);
    extern U32 acquire_load(U32 *);
    extern void atomic_add(U32 *, U32);
    typedef void (*Bridge)(GumInvocationContext *);
    typedef struct { Bridge enter; Bridge leave; } Bridges;
    static U32 *counter(int offset) { return (U32 *)(journal + offset); }
    void own(void) { release_store(counter(52), 1); }
    void fail(void) { release_store(counter(48), 1); }
    void publish(unsigned char *payload) {
      U32 n = acquire_load(counter(28)) + 1;
      release_store(counter(28), n);
      if (n > 500000) { atomic_add(counter(36), 1); return; }
      unsigned char *slot = journal + 512 + (n - 1) * 128;
      memcpy(slot + 4, payload, 124);
      release_store((U32 *)slot, n);
      release_store(counter(32), n);
    }
    void enter(GumInvocationContext *ic) {
      Bridges *b = gum_invocation_context_get_listener_function_data(ic);
      atomic_add(counter(40), 1);
      atomic_add(counter(44), 1);
      b->enter(ic);
      atomic_add(counter(40), -1);
    }
    void leave(GumInvocationContext *ic) {
      Bridges *b = gum_invocation_context_get_listener_function_data(ic);
      atomic_add(counter(40), 1);
      b->leave(ic);
      atomic_add(counter(44), -1);
      atomic_add(counter(40), -1);
    }
    void *argument(GumInvocationContext *ic, int n) {
      return gum_invocation_context_get_nth_argument(ic, n);
    }
    void *token(GumInvocationContext *ic) {
      return gum_invocation_context_get_listener_invocation_data(ic, 8);
    }
    unsigned int thread(GumInvocationContext *ic) { return gum_invocation_context_get_thread_id(ic); }
  `, { journal, release_store: code, acquire_load: code.add(64), atomic_add: code.add(128) });
  native = { module, code,
    // Keep Frida's JS lock across the native copy/publication. Native callback
    // accounting is atomic across threads; record allocation is a single writer.
    publish: new NativeFunction(module.publish, 'void', ['pointer'], { scheduling: 'exclusive' }),
    own: new NativeFunction(module.own, 'void', []),
    fail: new NativeFunction(module.fail, 'void', []),
    argument: new NativeFunction(module.argument, 'pointer', ['pointer', 'int']),
    token: new NativeFunction(module.token, 'pointer', ['pointer']),
    thread: new NativeFunction(module.thread, 'uint', ['pointer']) };
  return { fd, size, version: 2, capacity: 500000, stride: 128, headerSize: 512,
    runId: config.runId, pid: Process.id, processBirth: config.processBirth, execEpoch: config.execEpoch,
    protocol: 'aarch64-release-acquire-v2' };
}

function attachJournalHook(address, callbacks) {
  const enter = new NativeCallback((ic) => {
    try {
      const token = native.token(ic).toString();
      const context = { threadId: native.thread(ic) };
      contexts.set(token, context);
      callbacks.onEnter?.call(context, Array.from({ length: 7 }, (_, index) => native.argument(ic, index)));
    } catch (error) { native.fail(); }
  }, 'void', ['pointer']);
  const leave = new NativeCallback((ic) => {
    try {
      const token = native.token(ic).toString();
      const context = contexts.get(token);
      if (!context) throw new Error('missing native invocation');
      callbacks.onLeave?.call(context);
      contexts.delete(token);
    } catch (error) { native.fail(); }
  }, 'void', ['pointer']);
  const data = Memory.alloc(16);
  data.writePointer(enter);
  data.add(8).writePointer(leave);
  bridges.push({ enter, leave, data });
  hooks.push(Interceptor.attach(address, { onEnter: native.module.enter, onLeave: native.module.leave }, data));
}
rpc.exports = {
  initializeParent(config) {
    if (configured) throw new Error('agent already configured');
    configured = true;
    parentConfiguration = config;
    const module = Process.enumerateModules()[0];
    if (module.path !== config.loadedPath || Process.arch !== 'arm64') throw new Error('parent module mismatch');
    for (const target of config.targets) parentTargets.set(target.pid, target.osBirth);
    const emit = (event, fields) => {
      if (++sequence > 4096) throw new Error('parent status capacity exceeded');
      send({ event, runId: config.runId, pid: Process.id, processBirth: config.processBirth,
        seq: sequence, ns: now(), ...fields });
    };
    for (const name of ['waitpid', 'wait4']) {
      hooks.push(Interceptor.attach(Module.getGlobalExportByName(name), {
        onEnter(args) {
          this.startedNs = now();
          this.requestedPid = args[0].toInt32();
          this.status = args[1];
          this.options = args[2].toInt32();
          this.targets = new Map();
          for (const [pid, osBirth] of parentTargets) {
            if (this.requestedPid > 0 && this.requestedPid !== pid) continue;
            try {
              const raw = File.readAllText(`/proc/${pid}/stat`);
              const fields = raw.slice(raw.lastIndexOf(')') + 1).trim().split(/\s+/u);
              if (`${pid}:${fields[19]}` === osBirth && Number(fields[1]) === Process.id) {
                this.targets.set(pid, { pid, processBirth: osBirth, parentPid: Process.id, stat: raw,
                  exitCodeRaw: ['Z', 'X'].includes(fields[0]) ? Number(fields[49]) : null });
              }
            } catch (error) {
              // A missing/reaped child cannot become a birth-bound status witness.
            }
          }
        },
        onLeave(retval) {
          const pid = retval.toInt32();
          if (pid <= 0) return;
          emit('parent-reap', { function: name, startedNs: this.startedNs, requestedPid: this.requestedPid,
            options: this.options, result: pid, thread: this.threadId,
            target: this.targets.get(pid) ?? { pid, missing: true },
            statusRaw: this.status.isNull() ? null : this.status.readS32(), normal: true });
        },
      }));
    }
    Interceptor.flush();
    emit('parent-wait-ready', { hooks: ['waitpid', 'wait4'], loadedPath: module.path });
    return true;
  },
  registerChild(config) {
    if (!parentConfiguration || config.runId !== parentConfiguration.runId) throw new Error('parent registration mismatch');
    parentTargets.set(config.pid, config.osBirth);
    return true;
  },
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
            target = { pid, processBirth: `${pid}:${fields[19]}`, state: fields[0],
              exitCodeRaw: ['Z', 'X'].includes(fields[0]) ? Number(fields[49]) : null };
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
    configuration = config;
    return createJournal(config);
  },
  acknowledgeOwnership() {
    const config = configuration;
    if (!config || readyNs) throw new Error('journal ownership state mismatch');
    native.own();
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
      attachJournalHook(address, callbacks);
    }
    Interceptor.flush();
    record('hooks-ready', { hooks: hooks.length });
    return { loadedPath: module.path, base: module.base.toString(), arch: Process.arch,
      pointerSize: Process.pointerSize, hooks: hooks.length, readyNs };
  },
  drain() {
    return { ns: now() };
  },
  stop() {
    for (const hook of hooks) hook.detach();
    Interceptor.flush();
    return true;
  },
};
