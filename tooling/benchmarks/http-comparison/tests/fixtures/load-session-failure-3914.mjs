import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { hostname } from 'node:os';

const defect = process.env.LOAD_SESSION_DEFECT;
const identity = { protocol: 'local-session-v1', pid: process.pid, nonce: randomUUID(),
  node: process.version, executable: process.execPath, hostname: hostname() };
process.stdout.write(`FIXTURE_PID=${process.pid}\n`);
process.stderr.write('fixture diagnostic\n');
process.on('disconnect', () => process.exit(0));
process.on('message', ({ id, type }) => {
  if (type === 'init') {
    if (defect === 'ready-exit') process.exit(17);
    else if (defect === 'ready-hang') writeFileSync(process.env.LOAD_SESSION_SIGNAL, 'waiting');
    else process.send({ id, payload: JSON.stringify(defect === 'ready-malformed' ? {} : identity) });
    return;
  }
  switch (defect) {
    case 'exit': process.exit(19); break;
    case 'malformed': process.send({ nonsense: true }); break;
    case 'wrong-id': process.send({ id: id + 1, payload: '{}' }); break;
    case 'bad-payload': process.send({ id, payload: '{invalid' }); break;
    case 'nonzero-traffic':
      process.send({ id, payload: JSON.stringify({
        generator: identity, statusMismatches: 0,
        result: { errors: 1, timeouts: 0, non2xx: 0, mismatches: 0,
          requests: { total: 1, average: 1 }, throughput: { average: 1 }, latency: { average: 1 } },
        clientCpu: { userMicros: 1, systemMicros: 1, wallMicros: 1, coreEquivalentPercent: 1 },
        latencyHistogramMicros: [[1000, 1]], latencyPercentilesMs: { p50: 1, p95: 1, p99: 1 },
      }) });
      break;
    case 'hang': break;
    case 'buffer': process.stdout.write(Buffer.alloc(64 * 1024 * 1024 + 1, 120)); break;
    default: throw new Error(`Unknown fixture defect: ${defect}`);
  }
});
