import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { flushJournalPhases } from '../../results/issue-3914/paired-ab.mjs';

const [mode, outputPath, ordinalText, arm, generatorEntry] = process.argv.slice(2);
const ordinal = Number(ordinalText);
if (mode === 'exit') {
  process.stderr.write('FINITE_COLLECTOR_EARLY_EXIT\n');
  process.exit(17);
}
if (mode === 'hang') {
  const server = createServer((_request, response) => response.end('ok'));
  const listening = once(server, 'listening', { signal: AbortSignal.timeout(5_000) });
  server.listen(0, '127.0.0.1');
  await listening;
  // Ignore graceful termination to exercise the parent's bounded process-group kill.
  process.on('SIGTERM', () => { process.stderr.write('FINITE_COLLECTOR_IGNORED_TERM\n'); });
  await writeFile(`${outputPath}.ready`, JSON.stringify({ pid: process.pid, address: server.address() }), { flag: 'wx' });
} else {
  const { scenarioFixture } = await import('./load-session-support-3914.mjs');
  const { runScenario } = await import('../../src/run');
  const setup = await scenarioFixture(dirname(outputPath), `paired-ab-${ordinal}`);
  setup.journal.finish();
  const { EvidenceJournal } = await import('../../src/evidence');
  const journal: import('../../src/evidence').EvidenceJournal = new EvidenceJournal(`${outputPath}.phases.json`,
    () => ({ samples: setup.samples, current: journal.current }));
  flushJournalPhases(journal);
  try {
    await runScenario(setup.scenario, {
      index: 0, repeat: ordinal, targets: [setup.target], connections: 1,
      samples: setup.samples, journal, amount: 3, loadClientEntry: generatorEntry,
    });
    await writeFile(outputPath, JSON.stringify({
      correctnessOnly: true, ordinal, arm, invalidAttempts: journal.failures,
      identity: { collectorPid: process.pid }, raw: setup.samples[0],
    }), { flag: 'wx' });
  } finally {
    journal.finish();
  }
}
