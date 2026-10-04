import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeNativeJournal } from '../../src/native-lifetime.mjs';

const output = resolve(process.argv[2]);
const hash = (raw) => createHash('sha256').update(raw).digest('hex');
const agentSha256 = hash(await readFile(new URL('../../src/native-lifetime-agent.js', import.meta.url)));
const records = (await readdir(output)).filter((name) => name.endsWith('.json'));
assert.equal(records.length, 6);
let events = 0;
for (const name of records) {
  const record = JSON.parse(await readFile(resolve(output, name)));
  const loaded = await readFile(resolve(output, name.replace('.json', '-loaded.js')));
  const agent = await readFile(new URL('../../src/native-lifetime-agent.js', import.meta.url));
  assert.deepEqual(loaded.subarray(0, agent.length), agent);
  const decoded = decodeNativeJournal(record.journal, record.process, record.runId);
  assert.deepEqual(decoded, record.events.map((entry) => ({ ...entry, runId: record.runId,
    pid: record.process.pid, processBirth: record.process.processBirth })));
  if (name === 'canonical-deep.json') assert.equal(decoded.length, 131);
  events += decoded.length;
  for (const corrupt of [
    (raw) => raw.writeUInt32LE(1, 36), (raw) => raw.writeUInt32LE(1, 40),
    (raw) => raw.writeUInt32LE(1, 44), (raw) => raw.writeUInt32LE(1, 48),
    (raw) => raw.writeUInt32LE(0, 52), (raw) => raw.writeUInt32LE(8, 24),
    (raw) => raw.writeUInt32LE(0, 512), (raw) => raw.writeUInt32BE(1, 512),
    (raw) => raw.writeUInt32LE(1 << 11, 616), (raw) => { raw[620] = 1; },
  ]) {
    const raw = Buffer.from(record.journal.raw, 'base64');
    corrupt(raw);
    assert.throws(() => decodeNativeJournal({ ...record.journal, raw: raw.toString('base64') },
      record.process, record.runId), /incomplete\/foreign native journal/u);
  }
}
process.stdout.write(`${JSON.stringify({ verdict: 'PASS', records: records.length, events,
  corruptionRejections: records.length * 10, agentSha256,
  hostSha256: hash(await readFile(new URL('../../src/native-lifetime-host.py', import.meta.url))),
  decoderSha256: hash(await readFile(new URL('../../src/native-lifetime.mjs', import.meta.url))),
  performanceAcceptance: false })}\n`);
