export interface GeneratedFile {
  content: string;
  path: string;
}

export type GeneratorKind = 'controller' | 'guard' | 'interceptor' | 'middleware' | 'module' | 'repo' | 'request-dto' | 'response-dto' | 'service';

export interface GenerateOptions {
  force?: boolean;
}

export interface ModuleRegistration {
  className: string;
  kind: 'controller' | 'provider';
}
