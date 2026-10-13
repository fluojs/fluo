import { isIPv4 } from 'node:net';
import { object } from '../profile-report';

export interface LanTransport {
  readonly kind: 'ssh-lan';
  readonly serverHost: string;
  readonly serverPort: number;
  readonly bindHost: string;
  readonly sshTarget: string;
  readonly remoteDirectory: string;
  readonly sshControl: string | null;
}

function privateAddress(value: string): boolean {
  if (!isIPv4(value)) return false;
  const [first, second] = value.split('.').map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

export function parseTransport(value: unknown): LanTransport {
  const input = object(value);
  if (input.kind !== 'ssh-lan' || typeof input.serverHost !== 'string'
    || !privateAddress(input.serverHost) || typeof input.bindHost !== 'string'
    || (input.bindHost !== '0.0.0.0' && input.bindHost !== input.serverHost)
    || typeof input.serverPort !== 'number' || !Number.isSafeInteger(input.serverPort)
    || input.serverPort < 1 || input.serverPort > 65535
    || typeof input.sshTarget !== 'string' || !/^[A-Za-z0-9_.-]+@[\d.]+$/.test(input.sshTarget)
    || !privateAddress(input.sshTarget.split('@')[1])
    || input.sshTarget.split('@')[1] === input.serverHost
    || typeof input.remoteDirectory !== 'string' || !/^\/[A-Za-z0-9/_.-]+$/.test(input.remoteDirectory)
    || (input.sshControl !== null && (typeof input.sshControl !== 'string'
      || !/^\/[A-Za-z0-9/_.-]+$/.test(input.sshControl)))) {
    throw new TypeError('Frozen topology requires a private WSL2 server and independent Mac SSH generator');
  }
  return {
    kind: input.kind, serverHost: input.serverHost, serverPort: input.serverPort,
    bindHost: input.bindHost, sshTarget: input.sshTarget,
    remoteDirectory: input.remoteDirectory, sshControl: input.sshControl,
  };
}

export function assertTransport(transport: LanTransport, environment: NodeJS.ProcessEnv = process.env): void {
  const expected = {
    BENCH_SERVER_HOST: transport.serverHost,
    BENCH_BIND_HOST: transport.bindHost,
    BENCH_SSH_HOST: transport.sshTarget,
    BENCH_REMOTE_DIR: transport.remoteDirectory,
    BENCH_SSH_CONTROL: transport.sshControl ?? undefined,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (environment[key] !== value) throw new Error(`Frozen LAN transport drift: ${key}`);
  }
}
