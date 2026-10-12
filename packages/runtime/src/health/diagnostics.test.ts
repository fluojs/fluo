import { describe, expect, it } from 'vitest';

import { Scope } from '@fluojs/core';

import { defineRuntimeModuleMetadata } from '../internal/core-metadata.js';
import { compileModuleGraph } from '../module-graph.js';
import {
  createBootstrapTimingDiagnostics,
  createRuntimeDiagnosticsGraph,
  renderRuntimeDiagnosticsMermaid,
} from './diagnostics.js';

describe('runtime diagnostics graph export', () => {
  it('projects inherited and explicit declaration scopes without following alias lifetimes', () => {
    @Scope('request')
    class RequestBase {}
    class InheritedRequest extends RequestBase {}
    @Scope('transient')
    class TransientResolver {}
    class RootModule {}
    defineRuntimeModuleMetadata(RootModule, {
      providers: [
        InheritedRequest,
        { provide: 'inherited-class', useClass: InheritedRequest },
        { provide: 'explicit-class', useClass: InheritedRequest, scope: 'singleton' },
        { provide: 'inherited-factory', useFactory: () => ({}), resolverClass: InheritedRequest },
        { provide: 'transient-factory', useFactory: () => ({}), resolverClass: TransientResolver },
        { provide: 'explicit-factory', useFactory: () => ({}), resolverClass: InheritedRequest, scope: 'transient' },
        { provide: 'default-factory', useFactory: () => ({}) },
        { provide: 'value', useValue: {}, scope: 'transient' },
        { provide: 'alias', useExisting: InheritedRequest },
      ],
    });

    const graph = createRuntimeDiagnosticsGraph(compileModuleGraph(RootModule), RootModule);

    expect(graph.modules[0].providers.map(({ token, type, scope }) => ({ token, type, scope }))).toEqual([
      { token: 'InheritedRequest', type: 'class', scope: 'request' },
      { token: 'inherited-class', type: 'class', scope: 'request' },
      { token: 'explicit-class', type: 'class', scope: 'singleton' },
      { token: 'inherited-factory', type: 'factory', scope: 'request' },
      { token: 'transient-factory', type: 'factory', scope: 'transient' },
      { token: 'explicit-factory', type: 'factory', scope: 'transient' },
      { token: 'default-factory', type: 'factory', scope: 'singleton' },
      { token: 'value', type: 'value', scope: 'singleton' },
      { token: 'alias', type: 'existing', scope: 'singleton' },
    ]);
  });

  it('exports a versioned graph with module relationships and provider metadata', () => {
    const FACTORY_TOKEN = Symbol('FACTORY_TOKEN');
    const VALUE_TOKEN = Symbol('VALUE_TOKEN');

    class LoggerService {}

    @Scope('request')
    class RequestScopedService {}

    class UsersController {}

    class SharedModule {}
    defineRuntimeModuleMetadata(SharedModule, {
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
    defineRuntimeModuleMetadata(AppModule, {
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
    defineRuntimeModuleMetadata(SharedModule, {});

    class AppModule {}
    defineRuntimeModuleMetadata(AppModule, {
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
