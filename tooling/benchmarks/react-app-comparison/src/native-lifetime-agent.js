// ABI and offsets are supplied only after host ELF/hash/symbol authentication.
// Request records are release-published to a host-owned memfd, never send().
let configured = false;
let runId;
let processBirth;
let sequence = 0;
let callSerial = 0;
let journal;
let native;
let configuration;
let readyNs;
let parentConfiguration;
const parentTargets = new Map();
const hooks = [];
const clock = new NativeFunction(Module.getGlobalExportByName('clock_gettime'), 'int',
  ['int', 'pointer'], { scheduling: 'exclusive' });
const timespec = Memory.alloc(16);

function now() {
  if (clock(1, timespec) !== 0) throw new Error('CLOCK_MONOTONIC failed');
  return (BigInt(timespec.readS64().toString()) * 1000000000n
    + BigInt(timespec.add(8).readS64().toString())).toString();
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
  const state = Memory.alloc(64);
  const module = new CModule(`
#include <gum/guminterceptor.h>
#include <string.h>

typedef guint32 U32;
typedef guint64 U64;
extern unsigned char journal[];
extern void release_store(U32 *, U32);
extern U32 acquire_load(U32 *);
extern void atomic_add(U32 *, U32);
/* Prepared Linux/AArch64 LP64 timespec, checked against the guest headers. */
typedef struct { gint64 sec; gint64 nsec; } ClockTime;
extern int native_clock_gettime(int, ClockTime *);

typedef struct Frame Frame;
struct Frame {
  U64 values[11];
  U32 mask;
  Frame *previous;
};
typedef struct { Frame *observer; Frame *call; } ThreadState;
typedef struct {
  GMutex mutex;
  GHashTable *resources;
  GHashTable *loaders;
  GHashTable *threads;
  U64 resource_serial;
  U64 loader_serial;
  U64 call_serial;
  U32 owner;
  U32 depth;
} State;
extern State state;
typedef char state_size_check[sizeof(State) == 64 ? 1 : -1];
typedef char pointer_size_check[sizeof(gpointer) == 8 ? 1 : -1];

static U32 *counter(int offset) { return (U32 *)(journal + offset); }
void own(void) { release_store(counter(52), 1); }
void fail(void) { release_store(counter(48), 1); }

/* The old JS lock serialized state and publication. Keep that ordering in C.
 * No lock is held across the intercepted application's body. A callback that
 * reenters on the same thread (e.g. while obtaining a clock) retains its own
 * invocation frame and stack payload. Mutex acquisition itself calls no hook.
 */
static void lock(U32 thread) {
  if (acquire_load(&state.owner) != thread) {
    g_mutex_lock(&state.mutex);
    release_store(&state.owner, thread);
  }
  state.depth++;
}
static void unlock(void) {
  if (--state.depth == 0) {
    release_store(&state.owner, 0);
    g_mutex_unlock(&state.mutex);
  }
}

void init(void) {
  g_mutex_init(&state.mutex);
  state.resources = g_hash_table_new_full(g_direct_hash, g_direct_equal, NULL, NULL);
  state.loaders = g_hash_table_new_full(g_direct_hash, g_direct_equal, NULL, g_free);
  state.threads = g_hash_table_new_full(g_direct_hash, g_direct_equal, NULL, g_free);
}
void finalize(void) {
  g_hash_table_unref(state.resources);
  g_hash_table_unref(state.loaders);
  g_hash_table_unref(state.threads);
  g_mutex_clear(&state.mutex);
}

/* Byte offsets, including absent fields and reserved zeros, are wire ABI.
 * The timestamp is taken before reserving a slot, exactly as in the bridge.
 * Stack storage cannot alias a nested/reentrant record.
 */
static U64 record(U32 event, const Frame *frame) {
  unsigned char payload[124];
  ClockTime time;
  U64 timestamp;
  U32 n;
  unsigned char *slot;
  if (native_clock_gettime(1, &time) != 0) { fail(); return 0; }
  timestamp = (U64)time.sec * 1000000000ULL + (U64)time.nsec;
  memset(payload, 0, sizeof(payload));
  memcpy(payload, &event, 4);
  memcpy(payload + 4, &timestamp, 8);
  memcpy(payload + 12, frame->values, 88);
  memcpy(payload + 100, &frame->mask, 4);
  n = acquire_load(counter(28)) + 1;
  release_store(counter(28), n);
  if (n > 500000) { atomic_add(counter(36), 1); return timestamp; }
  slot = journal + 512 + (n - 1) * 128;
  memcpy(slot + 4, payload, 124);
  release_store((U32 *)slot, n);
  release_store(counter(32), n);
  return timestamp;
}
U64 ready(U32 hooks, U32 thread) {
  Frame frame;
  U64 timestamp;
  memset(&frame, 0, sizeof(frame));
  frame.values[10] = hooks;
  frame.mask = 1 << 10;
  lock(thread);
  timestamp = record(1, &frame);
  unlock();
  return timestamp;
}

static ThreadState *thread_state(U32 thread) {
  gpointer key = GUINT_TO_POINTER(thread);
  ThreadState *value = g_hash_table_lookup(state.threads, key);
  if (value == NULL) {
    value = g_new0(ThreadState, 1);
    g_hash_table_insert(state.threads, key, value);
  }
  return value;
}
static U64 resource_birth(gpointer resource) {
  return (U64)GPOINTER_TO_SIZE(g_hash_table_lookup(state.resources, resource));
}

/* Function data: resource=1, loader=2, observer=3, identifier=4,
 * cancel=5, error=6. Both identifier overloads share the same event kind.
 */
void enter(GumInvocationContext *ic) {
  U32 kind = GPOINTER_TO_UINT(gum_invocation_context_get_listener_function_data(ic));
  U32 thread = gum_invocation_context_get_thread_id(ic);
  Frame *frame;
  Frame **slot;
  ThreadState *local;
  gpointer object;
  gpointer resource;
  atomic_add(counter(40), 1);
  atomic_add(counter(44), 1);
  lock(thread);
  /* Gum may relocate its invocation array as nesting grows. Only the stored
   * pointer's value survives that move; never retain an address into the array.
   * This uses the baseline's same eight-byte Gum invocation allocation.
   */
  slot = GUM_IC_GET_INVOCATION_DATA(ic, Frame *);
  if (slot == NULL) { fail(); goto done; }
  frame = g_new0(Frame, 1);
  *slot = frame;
  switch (kind) {
    case 1:
      object = gum_invocation_context_get_nth_argument(ic, 0);
      frame->values[0] = (U64)GPOINTER_TO_SIZE(object);
      frame->values[1] = ++state.resource_serial;
      frame->mask = 3;
      g_hash_table_insert(state.resources, object, GSIZE_TO_POINTER(frame->values[1]));
      break;
    case 2: {
      Frame *binding;
      object = gum_invocation_context_get_nth_argument(ic, 0);
      resource = gum_invocation_context_get_nth_argument(ic, 3);
      frame->values[0] = (U64)GPOINTER_TO_SIZE(resource);
      frame->values[1] = resource_birth(resource);
      frame->values[2] = (U64)GPOINTER_TO_SIZE(object);
      frame->values[3] = ++state.loader_serial;
      frame->mask = 15;
      binding = g_memdup2(frame, sizeof(*frame));
      g_hash_table_replace(state.loaders, object, binding);
      break;
    }
    case 3:
      local = thread_state(thread);
      resource = gum_invocation_context_get_nth_argument(ic, 6);
      frame->values[0] = (U64)GPOINTER_TO_SIZE(resource);
      frame->values[1] = resource_birth(resource);
      frame->values[5] = ++state.call_serial;
      frame->mask = 3 | (1 << 5);
      frame->previous = local->observer;
      local->observer = frame;
      break;
    case 4:
      local = g_hash_table_lookup(state.threads, GUINT_TO_POINTER(thread));
      if (local != NULL && local->observer != NULL) {
        memcpy(frame->values, local->observer->values, sizeof(frame->values));
        frame->values[4] = (U64)GPOINTER_TO_SIZE(gum_invocation_context_get_nth_argument(ic, 1));
        frame->mask = local->observer->mask | (1 << 4);
        record(4, frame);
      }
      break;
    case 5:
    case 6: {
      Frame *binding;
      local = thread_state(thread);
      object = gum_invocation_context_get_nth_argument(ic, 0);
      binding = g_hash_table_lookup(state.loaders, object);
      if (binding != NULL) {
        memcpy(frame->values, binding->values, sizeof(frame->values));
        frame->mask = binding->mask;
      }
      frame->values[2] = (U64)GPOINTER_TO_SIZE(object);
      frame->values[6] = ++state.call_serial;
      frame->values[7] = local->call != NULL ? local->call->values[6] : 0;
      frame->values[8] = thread;
      frame->mask |= (1 << 2) | (1 << 6) | (1 << 7) | (1 << 8);
      frame->previous = local->call;
      local->call = frame;
      record(kind, frame);
      break;
    }
    default:
      fail();
  }
done:
  unlock();
  atomic_add(counter(40), -1);
}

void leave(GumInvocationContext *ic) {
  U32 kind = GPOINTER_TO_UINT(gum_invocation_context_get_listener_function_data(ic));
  U32 thread = gum_invocation_context_get_thread_id(ic);
  Frame *frame;
  Frame **slot;
  ThreadState *local;
  atomic_add(counter(40), 1);
  lock(thread);
  slot = GUM_IC_GET_INVOCATION_DATA(ic, Frame *);
  if (slot == NULL || *slot == NULL) { fail(); goto done; }
  frame = *slot;
  switch (kind) {
    case 1: record(2, frame); break;
    case 2: record(3, frame); break;
    case 3:
      local = g_hash_table_lookup(state.threads, GUINT_TO_POINTER(thread));
      if (local == NULL || local->observer != frame) { fail(); break; }
      local->observer = frame->previous;
      if (local->observer == NULL && local->call == NULL)
        g_hash_table_remove(state.threads, GUINT_TO_POINTER(thread));
      break;
    case 4: break;
    case 5:
    case 6:
      local = g_hash_table_lookup(state.threads, GUINT_TO_POINTER(thread));
      if (local == NULL || local->call != frame) { fail(); break; }
      local->call = frame->previous;
      if (local->observer == NULL && local->call == NULL)
        g_hash_table_remove(state.threads, GUINT_TO_POINTER(thread));
      frame->values[9] = 1;
      frame->mask |= 1 << 9;
      record(kind == 5 ? 8 : 7, frame);
      break;
    default:
      fail();
  }
  *slot = NULL;
  g_free(frame);
done:
  unlock();
  atomic_add(counter(44), -1);
  atomic_add(counter(40), -1);
}

  `, { journal, state, release_store: code, acquire_load: code.add(64), atomic_add: code.add(128),
    native_clock_gettime: Module.getGlobalExportByName('clock_gettime') });
  native = { module, code, state,
    own: new NativeFunction(module.own, 'void', []),
    fail: new NativeFunction(module.fail, 'void', []),
    ready: new NativeFunction(module.ready, 'uint64', ['uint', 'uint']) };
  return { fd, size, version: 2, capacity: 500000, stride: 128, headerSize: 512,
    runId: config.runId, pid: Process.id, processBirth: config.processBirth, execEpoch: config.execEpoch,
    protocol: 'aarch64-release-acquire-v2' };
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
    const emit = (event, fields, timestamp = now()) => {
      if (++sequence > 4096) throw new Error('shutdown event capacity exceeded');
      send({ event, runId: config.runId, pid: Process.id, processBirth: config.processBirth,
        seq: sequence, ns: timestamp, ...fields });
    };
    const enter = (context, event, fields, timestamp) => {
      const nested = stack.get(context.threadId) ?? [];
      context.binding = { call: ++callSerial, parent: nested.at(-1) ?? null, thread: context.threadId, ...fields };
      nested.push(context.binding.call);
      stack.set(context.threadId, nested);
      emit(`${event}-enter`, context.binding, timestamp);
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
        // Observe signal entry before the independent target /proc query.
        const enteredNs = now();
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
        enter(this, 'shutdown-signal', { signal: args[1].toInt32(), target }, enteredNs);
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
      const kind = ['resource', 'loader', 'observer', 'identifier', 'cancel', 'error'].indexOf(hook.event) + 1;
      if (!kind) throw new Error('unknown native hook');
      const address = module.base.add(hook.offset);
      const range = Process.findRangeByAddress(address);
      if (!range?.protection.includes('x')) throw new Error('hook outside executable mapping');
      hooks.push(Interceptor.attach(address, { onEnter: native.module.enter, onLeave: native.module.leave }, ptr(kind)));
    }
    Interceptor.flush();
    readyNs = native.ready(hooks.length, Process.getCurrentThreadId()).toString();
    if (readyNs === '0') throw new Error('CLOCK_MONOTONIC failed');
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
