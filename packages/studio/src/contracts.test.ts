import { describe, expect, it } from 'vitest';

import { applyFilters, parseStudioPayload, renderMermaid, type RuntimeDiagnosticsGraph } from './contracts.js';

const graphFixture: RuntimeDiagnosticsGraph = {
  version: 1,
  rootModule: 'AppModule',
  modules: [
    {
      name: 'AppModule',
      global: false,
      imports: ['SharedModule'],
      controllers: ['UsersController'],
      providers: [{ token: 'UserService', type: 'class', scope: 'singleton', multi: false }],
      exports: [],
    },
    {
      name: 'SharedModule',
      global: true,
      imports: [],
      controllers: [],
      providers: [{ token: 'CacheFactory', type: 'factory', scope: 'request', multi: false }],
      exports: ['CacheFactory'],
    },
  ],
  relationships: {
    moduleImports: [{ from: 'AppModule', to: 'SharedModule' }],
    moduleExports: [{ module: 'SharedModule', token: 'CacheFactory' }],
    moduleProviders: [
      { module: 'AppModule', token: 'UserService', providerType: 'class', scope: 'singleton', multi: false },
      { module: 'SharedModule', token: 'CacheFactory', providerType: 'factory', scope: 'request', multi: false },
    ],
    moduleControllers: [{ module: 'AppModule', controller: 'UsersController' }],
  },
};

describe('parseStudioPayload', () => {
  it('parses diagnostics graph payload', () => {
    const parsed = parseStudioPayload(JSON.stringify(graphFixture));
    expect(parsed.payload.graph?.rootModule).toBe('AppModule');
  });

  it('parses envelope with graph and timing', () => {
    const parsed = parseStudioPayload(
      JSON.stringify({
        graph: graphFixture,
        timing: {
          phases: [{ durationMs: 1.23, name: 'bootstrap_module' }],
          totalMs: 1.23,
          version: 1,
        },
      }),
    );
    expect(parsed.payload.graph?.modules).toHaveLength(2);
    expect(parsed.payload.timing?.phases).toHaveLength(1);
  });

  it('rejects unsupported version with explicit message', () => {
    expect(() =>
      parseStudioPayload(
        JSON.stringify({
          ...graphFixture,
          version: 2,
        }),
      ),
    ).toThrow('Unsupported diagnostics graph version. Expected version: 1.');
  });
});

describe('applyFilters', () => {
  it('filters by query/provider type/scope/global', () => {
    const filtered = applyFilters(graphFixture, {
      globalsOnly: true,
      query: 'cache',
      scopes: ['request'],
      types: ['factory'],
    });

    expect(filtered.modules.map((module) => module.name)).toEqual(['SharedModule']);
    expect(filtered.relationships.moduleImports).toHaveLength(0);
  });
});

describe('renderMermaid', () => {
  it('renders module nodes and import edges', () => {
    const output = renderMermaid(graphFixture);
    expect(output).toContain('graph TD');
    expect(output).toContain('AppModule');
    expect(output).toContain('-->');
    expect(output).toContain('rootModule');
  });
});
