import type { Constructor, Token } from '@konekti/core';
import type { Provider } from '@konekti-internal/di';

export type ModuleType = Constructor & { definition?: ModuleDefinition };
export type ControllerType = Constructor;

export interface ModuleDefinition {
  imports?: ModuleType[];
  providers?: Provider[];
  controllers?: ControllerType[];
  exports?: Token[];
}

export interface CompiledModule {
  type: ModuleType;
  definition: ModuleDefinition;
  exportedTokens: Set<Token>;
  providerTokens: Set<Token>;
}

export interface BootstrapResult {
  container: import('@konekti-internal/di').Container;
  modules: CompiledModule[];
  rootModule: ModuleType;
}
