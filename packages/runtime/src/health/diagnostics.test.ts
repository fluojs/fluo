import { describe, expect, it } from 'vitest';

import { Scope } from '@fluojs/core';
import { defineModuleMetadata } from '@fluojs/core/internal';

import { compileModuleGraph } from '../module-graph.js';
import {
  createBootstrapTimingDiagnostics,
  createRuntimeDiagnosticsGraph,
  renderRuntimeDiagnosticsMermaid,
} from './diagnostics.js';

describe('runtime diagnostics graph export', () => {
  it('exports a versioned graph with module relationships and provider metadata', () => {
    const FACTORY_TOKEN = Symbol('FACTORY_TOKEN');
    const VALUE_TOKEN = Symbol('VALUE_TOKEN');

    class LoggerService {}

    @Scope('request')
    class RequestScopedService {}

    class UsersController {}

    class SharedModule {}
    defineModuleMetadata(SharedModule, {
      exports: [LoggerService, FACTORY_TOKEN],
      providers: [
        LoggerService,
        {
          inject: [LoggerService],
          provide: FACTORY_TOKEN,
          scope: 'transient',
          useFactory: () => ({ ok: true }),
        },
      ],
    });

    class AppModule {}
    defineModuleMetadata(AppModule, {
      controllers: [UsersController],
      exports: [VALUE_TOKEN],
      imports: [SharedModule],
      providers: [
        RequestScopedService,
        {
          multi: true,
          provide: VALUE_TOKEN,
          useValue: 'value-entry',
        },
      ],
    });

    const compiledModules = compileModuleGraph(AppModule);
    const graph = createRuntimeDiagnosticsGraph(compiledModules, AppModule);

    expect(graph.version).toBe(1);
    expect(graph.rootModule).toBe('AppModule');
    expect(graph.modules.map((module) => module.name)).toEqual(['SharedModule', 'AppModule']);
    expect(graph.relationships.moduleImports).toContainEqual({ from: 'AppModule', to: 'SharedModule' });
    expect(graph.relationships.moduleControllers).toContainEqual({ controller: 'UsersController', module: 'AppModule' });
    expect(graph.relationships.moduleExports).toContainEqual({ module: 'SharedModule', token: 'LoggerService' });

    expect(graph.relationships.moduleProviders).toContainEqual({
      module: 'SharedModule',
      multi: false,
      providerType: 'factory',
      scope: 'transient',
      token: 'Symbol(FACTORY_TOKEN)',
    });

    expect(graph.relationships.moduleProviders).toContainEqual({
      module: 'AppModule',
      multi: false,
      providerType: 'class',
      scope: 'request',
      token: 'RequestScopedService',
    });

    expect(graph.relationships.moduleProviders).toContainEqual({
      module: 'AppModule',
      multi: true,
      providerType: 'value',
      scope: 'singleton',
      token: 'Symbol(VALUE_TOKEN)',
    });
  });

  it('renders module-level Mermaid output', () => {
    class SharedModule {}
    defineModuleMetadata(SharedModule, {});

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [SharedModule],
    });

    const graph = createRuntimeDiagnosticsGraph(compileModuleGraph(AppModule), AppModule);
    const mermaid = renderRuntimeDiagnosticsMermaid(graph);

    expect(mermaid).toContain('graph TD');
    expect(mermaid).toContain('AppModule');
    expect(mermaid).toContain('SharedModule');
    expect(mermaid).toContain('-->');
  });
});

describe('bootstrap timing diagnostics', () => {
  it('returns a versioned timing payload', () => {
    const diagnostics = createBootstrapTimingDiagnostics(
      [
        {
          durationMs: 1.234567,
          name: 'bootstrap_module',
        },
      ],
      3.210987,
    );

    expect(diagnostics).toEqual({
      phases: [{ durationMs: 1.235, name: 'bootstrap_module' }],
      totalMs: 3.211,
      version: 1,
    });
  });
});
