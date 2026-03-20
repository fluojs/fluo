export interface GeneratedFile {
  content: string;
  path: string;
}

export interface GenerateOptions {
  force?: boolean;
}

export type GeneratorFactory = (name: string, options?: GenerateOptions) => GeneratedFile[];

export interface GeneratorRegistration {
  factory: GeneratorFactory;
  description?: string;
}
