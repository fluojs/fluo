import '@fluojs/core/metadata-preload';

import { ConfigModule } from '@fluojs/config';
import { NodeHttpApplicationAdapter } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';

import { AppModule } from './app.module.js';

const FLOOR_CONFIG_TOKEN = 'fluoRuntimeFloorToken';
const FLOOR_CONFIG_VALUE = 'floor-config-24-0';

interface RuntimeFloorBehavior {
  readonly name: string;
  readonly passed: boolean;
  readonly detail?: string;
}

export async function runRuntimeFloorExercises(): Promise<RuntimeFloorBehavior[]> {
  const behaviors: RuntimeFloorBehavior[] = [];
  const record = (name: string, passed: boolean, detail = ''): void => {
    behaviors.push({ name, passed, detail });
  };

  try {
    const dictionary = ConfigModule.load({
      envFilePaths: [],
      defaults: { [FLOOR_CONFIG_TOKEN]: 'default-value' },
      processEnv: { [FLOOR_CONFIG_TOKEN]: FLOOR_CONFIG_VALUE },
      runtimeOverrides: {},
    });
    const loaded = dictionary?.[FLOOR_CONFIG_TOKEN];
    record(
      'config-in-memory-load',
      loaded === FLOOR_CONFIG_VALUE,
      `expected processEnv precedence to deliver "${FLOOR_CONFIG_VALUE}", received ${JSON.stringify(loaded)}`,
    );
  } catch (error) {
    record('config-in-memory-load', false, String(error));
  }

  const adapter = NodeHttpApplicationAdapter.create({ port: 0, host: '127.0.0.1' });
  let app: Awaited<ReturnType<typeof FluoFactory.create>> | undefined;

  try {
    app = await FluoFactory.create(AppModule, {
      adapter,
    });
    await app.listen();
    const address = adapter.getServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an OS-assigned TCP listener.');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const greeting = await fetch(`${baseUrl}/floor/greeting`);
    const greetingBody = await greeting.json();
    record(
      'http-listener-greeting-dispatch',
      greeting.status === 200 && greetingBody?.framework === 'fluo' && typeof greetingBody?.message === 'string',
      `GET /floor/greeting -> ${greeting.status} ${JSON.stringify(greetingBody)}`,
    );

    const health = await fetch(`${baseUrl}/health`);
    const healthBody = await health.json();
    record(
      'http-listener-health-readiness',
      health.status === 200 && healthBody != null && typeof healthBody === 'object',
      `GET /health -> ${health.status} ${JSON.stringify(healthBody)}`,
    );
  } catch (error) {
    record('http-listener-greeting-dispatch', behaviors.some((entry) => entry.name === 'http-listener-greeting-dispatch' && entry.passed), String(error));
    record('http-listener-health-readiness', behaviors.some((entry) => entry.name === 'http-listener-health-readiness' && entry.passed), String(error));
  }

  try {
    if (app) {
      await app.close();
      const closed = !adapter.getServer().listening;
      record('graceful-application-close', closed, closed ? 'listener stopped accepting connections' : 'listener still accepted a connection after close()');
    } else {
      record('graceful-application-close', false, 'the application never booted');
    }
  } catch (error) {
    record('graceful-application-close', false, String(error));
  }

  return behaviors;
}
