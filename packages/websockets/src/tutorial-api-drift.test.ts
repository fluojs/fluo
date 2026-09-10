import { readFileSync } from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const tutorialPaths = [
  '../../../book/intermediate/ch13-websockets.md',
  '../../../book/intermediate/ch13-websockets.ko.md',
  '../../../book/intermediate/ch22-bun.md',
  '../../../book/intermediate/ch22-bun.ko.md',
  '../../../book/intermediate/ch23-deno.md',
  '../../../book/intermediate/ch23-deno.ko.md',
  '../../../book/intermediate/ch24-cloudflare.md',
  '../../../book/intermediate/ch24-cloudflare.ko.md',
] as const;

function readTutorial(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('@fluojs/websockets tutorial API alignment', () => {
  it('does not document stale Nest-style lifecycle APIs', () => {
    for (const relativePath of tutorialPaths) {
      const content = readTutorial(relativePath);

      expect(content, relativePath).not.toContain('OnGatewayConnection');
      expect(content, relativePath).not.toContain('SubscribeMessage');
    }
  });

  it('keeps fetch-style runtime tutorials wired to their runtime modules', () => {
    const cases = [
      { chapter: 'ch22-bun', module: 'BunWebSocketModule', subpath: 'bun', decorators: ['OnConnect', 'WebSocketGateway'] },
      { chapter: 'ch23-deno', module: 'DenoWebSocketModule', subpath: 'deno', decorators: ['OnMessage', 'WebSocketGateway'] },
      { chapter: 'ch24-cloudflare', module: 'CloudflareWorkersWebSocketModule', subpath: 'cloudflare-workers', decorators: ['WebSocketGateway'] },
    ];
    for (const testCase of cases) {
      for (const locale of ['', '.ko']) {
        const content = readTutorial(`../../../book/intermediate/${testCase.chapter}${locale}.md`);
        const code = [...content.matchAll(/^```(?:ts|typescript)[^\n]*\n([\s\S]*?)^```/gm)]
          .map((match) => match[1]).join('\n');
        const source = ts.createSourceFile('tutorial.ts', code, ts.ScriptTarget.Latest, true);
        const imports: { name: string; local: string; source: string }[] = [];
        const registrations: string[] = [];
        const visit = (node: ts.Node): void => {
          if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const bindings = node.importClause?.namedBindings;
            if (bindings && ts.isNamedImports(bindings)) {
              for (const element of bindings.elements) {
                imports.push({
                  name: element.propertyName?.text ?? element.name.text,
                  local: element.name.text,
                  source: node.moduleSpecifier.text,
                });
              }
            }
          }
          if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
            && node.expression.name.text === 'forRoot' && ts.isIdentifier(node.expression.expression)) {
            registrations.push(node.expression.expression.text);
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
        const modules = imports.filter((entry) => entry.name === testCase.module);
        expect(modules.length).toBeGreaterThan(0);
        for (const entry of modules) {
          expect(entry.source).toBe(`@fluojs/websockets/${testCase.subpath}`);
          expect(registrations).toContain(entry.local);
        }
        for (const decorator of testCase.decorators) {
          const declarations = imports.filter((entry) => entry.name === decorator);
          expect(declarations.length).toBeGreaterThan(0);
          for (const entry of declarations) expect(entry.source).toBe('@fluojs/websockets');
        }
      }
    }
  });

  it('documents root and fetch-style pre-upgrade guards at their runtime import boundaries', () => {
    const chapter = readTutorial('../../../book/intermediate/ch13-websockets.md');
    const chapterKo = readTutorial('../../../book/intermediate/ch13-websockets.ko.md');

    expect(chapter).not.toContain('request instanceof Request');
    expect(chapter).toContain('request.headers.authorization');
    expect(chapter).toContain("Fetch-style subpaths such as `@fluojs/websockets/bun`, `@fluojs/websockets/deno`, and `@fluojs/websockets/cloudflare-workers` receive a Web-standard `Request`");
    expect(chapter).toContain("request.headers.get('authorization')");

    expect(chapterKo).not.toContain('request instanceof Request');
    expect(chapterKo).toContain('request.headers.authorization');
    expect(chapterKo).toContain('`@fluojs/websockets/bun`, `@fluojs/websockets/deno`, `@fluojs/websockets/cloudflare-workers` 같은 fetch-style subpath는 Web standard `Request`를 받습니다');
    expect(chapterKo).toContain("request.headers.get('authorization')");
  });

  it('keeps the README public API overview aligned with the room service export', () => {
    const readme = readTutorial('../README.md');
    const readmeKo = readTutorial('../README.ko.md');

    expect(readme).toContain('`WebSocketRoomService`: Room management contract');
    expect(readmeKo).toContain('`WebSocketRoomService`: websocket room join');
  });
});
