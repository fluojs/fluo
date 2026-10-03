import { cpus, hostname, release } from 'node:os';
import { shoot, TrafficFailure, type TrafficOptions } from './traffic';

const options: TrafficOptions = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
try {
  const measurement = await shoot(options, 'remote-load-client');
  process.stdout.write(JSON.stringify({
    ...measurement,
    generator: { hostname: hostname(), node: process.version, osRelease: release(), cpus: cpus().map((cpu) => cpu.model) },
  }));
} catch (error) {
  if (!(error instanceof TrafficFailure)) throw error;
  process.stdout.write(JSON.stringify({ failure: { message: error.message, diagnostics: error.diagnostics } }));
  process.exitCode = 1;
}
