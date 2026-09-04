export interface DtoBinding {
  readonly key: string | undefined;
  readonly member: string;
  readonly source: 'FromBody' | 'FromPath';
}

export interface GuideRouteBinding {
  readonly bindings: readonly DtoBinding[];
  readonly method: 'Get' | 'Post';
  readonly name: string;
  readonly parameterDto: string | undefined;
  readonly pathPlaceholders: readonly string[];
  readonly requestDto: string | undefined;
  readonly routePath: string;
}

export function intendedHttpSnippets(markdown: string): readonly string[];
export function semanticDiagnostics(relativePath: string, sourceText: string): string[];
export function exportedHttpNames(): Set<string>;
export function routeBindings(sourceText: string): GuideRouteBinding[];
export function classDecoratorArguments(sourceText: string, className: string, decoratorName: string): string[];
