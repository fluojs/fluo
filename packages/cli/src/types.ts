export interface GeneratedFile {
  content: string;
  path: string;
}

export type GeneratorKind = 'controller' | 'dto' | 'guard' | 'interceptor' | 'middleware' | 'module' | 'repo' | 'service';

export interface GenerateOptions {
  force?: boolean;
}

export interface ModuleRegistration {
  className: string;
  kind: 'controller' | 'provider';
}
