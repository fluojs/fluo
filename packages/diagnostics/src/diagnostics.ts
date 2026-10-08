/** Portable serialized DI lifetime labels, not a DI implementation dependency. */
export type RuntimeDiagnosticsScope = 'singleton' | 'request' | 'transient';

/**
 * Describes the runtime diagnostics graph contract.
 */
export interface RuntimeDiagnosticsGraph {
  version: 1;
  rootModule: string;
  modules: RuntimeDiagnosticsModule[];
  relationships: RuntimeDiagnosticsRelationships;
}

/**
 * Describes the runtime diagnostics module contract.
 */
export interface RuntimeDiagnosticsModule {
  name: string;
  global: boolean;
  imports: string[];
  controllers: string[];
  providers: RuntimeDiagnosticsProvider[];
  exports: string[];
}

/**
 * Describes the runtime diagnostics provider contract.
 */
export interface RuntimeDiagnosticsProvider {
  token: string;
  type: 'class' | 'factory' | 'value' | 'existing';
  scope: RuntimeDiagnosticsScope;
  multi: boolean;
}

/**
 * Describes the runtime diagnostics relationships contract.
 */
export interface RuntimeDiagnosticsRelationships {
  moduleImports: Array<{
    from: string;
    to: string;
  }>;
  moduleExports: Array<{
    module: string;
    token: string;
  }>;
  moduleProviders: Array<{
    module: string;
    token: string;
    providerType: RuntimeDiagnosticsProvider['type'];
    scope: RuntimeDiagnosticsScope;
    multi: boolean;
  }>;
  moduleControllers: Array<{
    controller: string;
    module: string;
  }>;
}
