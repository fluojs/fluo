// Bounded native diagnosis, not a benchmark or production implementation.
// The private cache observer is diagnostic-only and does not read request.signal.
const internals = Deno[Deno.internal];
if (typeof internals?.getCachedAbortSignal !== 'function') {
  throw new Error('Deno diagnostic cache observer unavailable; no causal verdict.');
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout: ${label}`)), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function cacheState(request) {
  const cached = internals.getCachedAbortSignal(request);
  return cached === undefined ? 'unmaterialized' : cached === false ? 'closed-unmaterialized' : 'materialized';
}

const records = [];
for (const mode of ['untouched', 'metadata', 'signal', 'clone-body']) {
  const done = Promise.withResolvers();
  const ready = Promise.withResolvers();
  const server = Deno.serve({
    hostname: '127.0.0.1',
    port: 0,
    onListen: ready.resolve,
  }, async (request, info) => {
    const record = { mode, before: cacheState(request) };
    let signal;
    // Subscribe to native delivery completion before returning a response.
    info.completed.then(() => {
      record.after = cacheState(request);
      if (signal) {
        record.aborted = signal.aborted;
        record.reasonName = signal.reason?.name;
        record.reasonMessage = signal.reason?.message;
        record.identityPreserved = signal === request.signal;
      }
      records.push(record);
      done.resolve();
    }, done.reject);

    if (mode === 'metadata') {
      assert(request.method === 'GET', 'Native request method changed');
      assert(new URL(request.url).pathname === '/finite', 'Native URL changed');
      new Headers(request.headers);
      void request.body;
    } else if (mode === 'signal') {
      signal = request.signal;
    } else if (mode === 'clone-body') {
      assert(await request.clone().text() === 'exact-body', 'Clone changed body');
      assert(!request.bodyUsed, 'Clone consumed original body');
      assert(await request.text() === 'exact-body', 'Original body unreadable');
      signal = request.signal;
    }
    record.beforeResponse = cacheState(request);
    return new Response('ok');
  });

  try {
    const address = await bounded(ready.promise, `${mode} ready`);
    const response = await fetch(`http://${address.hostname}:${address.port}/finite`, {
      ...(mode === 'clone-body' ? { method: 'POST', body: 'exact-body' } : {}),
      signal: AbortSignal.timeout(5000),
    });
    assert(response.status === 200 && await response.text() === 'ok', 'Native finite response mismatch');
    await bounded(done.promise, `${mode} completed`);
    const record = records.at(-1);
    if (mode === 'untouched' || mode === 'metadata') {
      assert(record.beforeResponse === 'unmaterialized' && record.after === 'closed-unmaterialized', `${mode} unexpectedly materialized signal`);
    } else {
      assert(record.beforeResponse === 'materialized' && record.aborted && record.reasonName === 'AbortError' && record.identityPreserved, `${mode} lost native completion signal contract`);
    }
  } finally {
    await server.shutdown();
    await server.finished;
  }
}

const peerStarted = Promise.withResolvers();
const peerAborted = Promise.withResolvers();
const peerCancelled = Promise.withResolvers();
const peerReady = Promise.withResolvers();
const peerServer = Deno.serve({
  hostname: '127.0.0.1',
  port: 0,
  onListen: peerReady.resolve,
}, (request, info) => {
  const signal = request.signal;
  info.completed.catch(() => {});
  signal.addEventListener('abort', () => {
    peerAborted.resolve({
      mode: 'peer-disconnect',
      aborted: signal.aborted,
      reasonName: signal.reason?.name,
      identityPreserved: signal === request.signal,
    });
  }, { once: true });
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('first'));
      peerStarted.resolve();
    },
    cancel(reason) {
      peerCancelled.resolve({ cancelReasonName: reason?.name });
    },
  }));
});

try {
  const address = await bounded(peerReady.promise, 'peer ready');
  const connection = await Deno.connect({ hostname: address.hostname, port: address.port });
  try {
    const bytes = new TextEncoder().encode('GET /peer HTTP/1.1\r\nHost: localhost\r\n\r\n');
    let offset = 0;
    while (offset < bytes.length) offset += await connection.write(bytes.subarray(offset));
    await bounded(peerStarted.promise, 'peer stream started');
    assert(await bounded(connection.read(new Uint8Array(4096)), 'peer first bytes') !== null, 'Peer received no bytes');
  } finally {
    connection.close();
  }
  const record = await bounded(peerAborted.promise, 'peer abort');
  Object.assign(record, await bounded(peerCancelled.promise, 'peer stream cancel'));
  assert(record.aborted && record.reasonName === 'AbortError' && record.identityPreserved, 'Peer disconnect lost native abort contract');
  records.push(record);
} finally {
  await peerServer.shutdown();
  await peerServer.finished;
}

const controller = new AbortController();
const reason = new Error('pre-abort-identity');
controller.abort(reason);
const preAborted = new Request('http://fluo.test/pre-abort', { signal: controller.signal });
assert(preAborted.signal.aborted && preAborted.signal.reason === reason && preAborted.signal === preAborted.signal, 'Native pre-abort reason or signal identity lost');
records.push({ mode: 'constructed-pre-abort', aborted: true, reasonIdentityPreserved: true });

console.log(JSON.stringify({
  runtime: Deno.version,
  servingRequests: 5,
  records,
  limitation: 'Native mechanism/correctness diagnosis only. No Fluo acceptance, CPU, allocation, throughput or capacity measurement.',
}, null, 2));
