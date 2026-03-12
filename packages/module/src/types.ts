import type { ConfigLoadOptions, ConfigMode, ConfigService } from '@konekti/config';
import type { Constructor, MaybePromise, Token } from '@konekti/core';
import type { Container, Provider } from '@konekti-internal/di';
import type { Dispatcher, HttpApplicationAdapter, MiddlewareLike } from '@konekti/http';

export type ModuleType = Constructor & { definition?: ModuleDefinition };
export type ControllerType = Constructor;

export interface ModuleDefinition {
  imports?: ModuleType[];
  providers?: Provider[];
  controllers?: ControllerType[];
  exports?: Token[];
  middleware?: MiddlewareLike[];
  global?: boolean;
}

export interface BootstrapModuleOptions {
  providers?: Provider[];
}

export interface CompiledModule {
  type: ModuleType;
  definition: ModuleDefinition;
  exportedTokens: Set<Token>;
  providerTokens: Set<Token>;
}

export interface BootstrapResult {
  container: Container;
  modules: CompiledModule[];
  rootModule: ModuleType;
}

export interface OnModuleInit {
  onModuleInit(): MaybePromise<void>;
}

export interface OnApplicationBootstrap {
  onApplicationBootstrap(): MaybePromise<void>;
}

export interface OnModuleDestroy {
  onModuleDestroy(): MaybePromise<void>;
}

export interface OnApplicationShutdown {
  onApplicationShutdown(signal?: string): MaybePromise<void>;
}

export type ApplicationState = 'bootstrapped' | 'ready' | 'closed';

export interface BootstrapApplicationOptions extends ConfigLoadOptions {
  adapter?: HttpApplicationAdapter;
  middleware?: MiddlewareLike[];
  providers?: Provider[];
  rootModule: ModuleType;
}

export interface Application {
  readonly config: ConfigService;
  readonly container: Container;
  readonly envFile: string;
  readonly mode: ConfigMode;
  readonly modules: CompiledModule[];
  readonly rootModule: ModuleType;
  readonly state: ApplicationState;
  readonly dispatcher: Dispatcher;

  close(signal?: string): Promise<void>;
  dispatch: Dispatcher['dispatch'];
  listen(): Promise<void>;
  ready(): Promise<void>;
}
