import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const phaseFile = process.argv[2];
const phase = Number(readFileSync(phaseFile, 'utf8')) + 1;
writeFileSync(phaseFile, String(phase));
let outputReady = Promise.resolve();
const server = createServer(async function readSearchLocal(_request, response) {
  await outputReady;
  response.end('{"ok":true}');
});
process.once('SIGTERM', async () => {
  if (phase === 3) {
    const bytes = Buffer.alloc(8192, 120);
    await new Promise((resolve, reject) => {
      process.stdout.write(bytes, (error) => error ? reject(error) : resolve());
    });
  }
  await new Promise((resolve, reject) => {
    process.stderr.write(`phase-${phase}-shutdown\n`, (error) => error ? reject(error) : resolve());
  });
  process.exit(0);
});
server.listen(Number(process.env.PORT), '127.0.0.1', () => {
  process.stdout.write(`listening on :${process.env.PORT}\n`);
  if (phase === 3) {
    // Gate the first response on the prefill, not the shutdown deadline.
    // Announce readiness first so the readiness buffer need not retain 64 MiB.
    outputReady = new Promise((resolve, reject) => {
      process.stdout.write(Buffer.alloc(64 * 1024 * 1024 - 4096, 120), (error) => error ? reject(error) : resolve());
    });
  }
});
