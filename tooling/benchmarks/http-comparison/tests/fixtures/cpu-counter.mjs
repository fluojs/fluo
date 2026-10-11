import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const frequency = Number(process.argv[2]);
process.once('message', async () => {
  try {
    const deadline = performance.now() + 5000;
    let digest = 'fractional-cpu-counter';
    while (true) {
      const text = await readFile(`/proc/${process.pid}/stat`, 'utf8');
      const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/);
      const seconds = (Number(fields[11]) + Number(fields[12])) / frequency;
      if (seconds % 1 >= 0.2 && seconds % 1 <= 0.4) break;
      if (performance.now() >= deadline) throw new Error('CPU observation interval not reached');
      for (let index = 0; index < 1000; index++) digest = createHash('sha256').update(digest).digest('hex');
    }
    process.once('message', () => process.disconnect());
    process.send('sample');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    process.disconnect();
  }
});
process.send('ready');
