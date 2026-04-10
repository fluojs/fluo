import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

type ExportTarget = {
  import: string;
  types: string;
};

describe('@fluojs/microservices transport subpath exports', () => {
  it('keeps documented transport subpaths aligned with emitted dist artifacts', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      exports: Record<string, ExportTarget>;
    };

    expect(packageJson.exports).toMatchObject({
      './grpc': {
        import: './dist/transports/grpc-transport.js',
        types: './dist/transports/grpc-transport.d.ts',
      },
      './kafka': {
        import: './dist/transports/kafka-transport.js',
        types: './dist/transports/kafka-transport.d.ts',
      },
      './mqtt': {
        import: './dist/transports/mqtt-transport.js',
        types: './dist/transports/mqtt-transport.d.ts',
      },
      './nats': {
        import: './dist/transports/nats-transport.js',
        types: './dist/transports/nats-transport.d.ts',
      },
      './redis': {
        import: './dist/transports/redis-transport.js',
        types: './dist/transports/redis-transport.d.ts',
      },
      './rabbitmq': {
        import: './dist/transports/rabbitmq-transport.js',
        types: './dist/transports/rabbitmq-transport.d.ts',
      },
      './tcp': {
        import: './dist/transports/tcp-transport.js',
        types: './dist/transports/tcp-transport.d.ts',
      },
    });
  });
});
