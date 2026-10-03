import { cpus, hostname, release } from 'node:os';
import { shoot, type TrafficOptions } from './traffic';

const options: TrafficOptions = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
const measurement = await shoot(options, 'remote-load-client');
process.stdout.write(JSON.stringify({
  ...measurement,
  generator: { hostname: hostname(), node: process.version, osRelease: release(), cpus: cpus().map((cpu) => cpu.model) },
}));
