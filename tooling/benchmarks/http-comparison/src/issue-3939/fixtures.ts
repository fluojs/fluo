import { createHash } from 'node:crypto';
import { ensureMetadataSymbol, Module } from '@fluojs/core';
import { Controller, Get, type RequestContext } from '@fluojs/http';
import type { ScenarioRequest } from '../traffic';

ensureMetadataSymbol();

const jsonSmall = { text: 'j'.repeat(501) };
const jsonLarge = { text: 'j'.repeat(65_525) };
const multibyte = (bytes: number) => '\u00e9'.repeat(bytes / 2);
const binary = Buffer.from('binary-control');

export const FIXTURES = [
  { name: 'json-small', body: jsonSmall, wire: JSON.stringify(jsonSmall) },
  { name: 'json-large', body: jsonLarge, wire: JSON.stringify(jsonLarge) },
  { name: 'ascii-small', body: 'a'.repeat(128), wire: 'a'.repeat(128) },
  { name: 'ascii-large', body: 'a'.repeat(65_536), wire: 'a'.repeat(65_536) },
  { name: 'utf8-small', body: multibyte(128), wire: multibyte(128) },
  { name: 'utf8-large', body: multibyte(65_536), wire: multibyte(65_536) },
  { name: 'json-string', body: 'quote"\u00e9', wire: '"quote\\"\u00e9"', contentType: 'application/json' },
  { name: 'buffer', body: binary, wire: binary.toString() },
  { name: 'uint8array', body: new Uint8Array(binary), wire: binary.toString() },
  { name: 'arraybuffer', body: new Uint8Array(binary).buffer, wire: binary.toString() },
  { name: 'empty', body: undefined, wire: '' },
] as const;

export const FIXTURE_MANIFEST = FIXTURES.map((fixture) => ({
  name: fixture.name,
  path: `/issue-3939/${fixture.name}`,
  status: 200,
  bytes: Buffer.byteLength(fixture.wire),
  sha256: createHash('sha256').update(fixture.wire).digest('hex'),
}));

export function fixtureRequest(name: string): ScenarioRequest {
  const fixture = FIXTURES.find((entry) => entry.name === name);
  if (!fixture) throw new RangeError(`Unknown #3939 fixture: ${name}`);
  return { path: `/issue-3939/${name}`, method: 'GET', expectedStatus: 200, expectedBody: fixture.wire };
}

@Controller('/issue-3939')
class ResponseController {
  @Get('/:fixture')
  async read(_input: undefined, context: RequestContext) {
    const fixture = FIXTURES.find((entry) => entry.name === context.request.params.fixture);
    if (!fixture) throw new RangeError('Unknown #3939 fixture');
    if ('contentType' in fixture) context.response.setHeader('Content-Type', fixture.contentType);
    await context.response.send(fixture.body);
  }
}

@Module({ controllers: [ResponseController] })
export class ResponseModule {}
