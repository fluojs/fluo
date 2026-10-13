import { ensureMetadataSymbol, Module } from '@fluojs/core';
import { Controller, Get, type RequestContext } from '@fluojs/http';
import type { RequestHandler } from 'express';
import { SCENARIOS, STAGE_SCENARIOS, type ScenarioConfig } from '../scenarios.js';
import { resolveAppModule } from '../shared/fluo-app.js';

ensureMetadataSymbol();

@Controller('/stage')
class MetadataController {
  @Get('')
  read(_input: undefined, context: RequestContext) {
    return {
      ok: true,
      requestId: context.requestId,
      native: context.request.headers['x-native-metadata'],
    };
  }
}

@Module({ controllers: [MetadataController] })
class MetadataModule {}

function scenario(name: string): ScenarioConfig {
  const found = [...SCENARIOS, ...STAGE_SCENARIOS].find((item) => item.name === name);
  if (!found) throw new TypeError(`Unknown existing scenario: ${name}`);
  return found;
}

const minimal = scenario('stage-minimal');
const headers: RequestHandler = (_request, response, next) => {
  response.setHeader('x-native-number', 7);
  response.setHeader('x-native-array', ['first', 'second']);
  response.setHeader('__proto__', 'own-header');
  response.setHeader('set-cookie', ['native=one; Path=/', 'native=two; Path=/']);
  next();
};
const metadata: RequestHandler = (request, _response, next) => {
  request.headers['x-native-metadata'] = 'tagged';
  request.headers['x-request-id'] = 'native-request-id';
  next();
};
const nativeBody: RequestHandler = (request, _response, next) => {
  // Do not consume the raw stream: the baseline ignores this pre-parsed value.
  request.body = { deliberately: 'not-the-wire-body' };
  next();
};

export const FIXTURES = [
  { name: 'plain-json', scenario: minimal, middleware: [] },
  { name: 'native-header-json', scenario: { ...minimal, name: 'native-header-json' }, middleware: [headers] },
  {
    name: 'native-metadata-json',
    scenario: {
      ...minimal, name: 'native-metadata-json',
      requests: [{
        path: '/stage', method: 'GET', expectedStatus: 200,
        expectedBody: '{"ok":true,"requestId":"native-request-id","native":"tagged"}',
      }],
    },
    middleware: [metadata],
  },
  { name: 'json-body-command', scenario: scenario('json-command-local'), middleware: [nativeBody] },
  { name: 'rest-route-mix', scenario: scenario('rest-route-mix-local'), middleware: [] },
] satisfies readonly {
  readonly name: string;
  readonly scenario: ScenarioConfig;
  readonly middleware: readonly RequestHandler[];
}[];

export function fixture(name: string) {
  const found = FIXTURES.find((item) => item.name === name);
  if (!found) throw new TypeError(`Unknown issue-3942 fixture: ${name}`);
  return found;
}

export function fixtureModule(name: string) {
  return name === 'native-metadata-json' ? MetadataModule : resolveAppModule(fixture(name).scenario.appShape);
}
