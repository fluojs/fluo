export interface GeneratedFile {
  content: string;
  path: string;
}

export type GeneratorKind = 'controller' | 'dto' | 'module' | 'repo' | 'service';

export type GeneratorPreset = 'drizzle' | 'generic' | 'prisma';

export interface GenerateOptions {
  preset?: GeneratorPreset;
}
