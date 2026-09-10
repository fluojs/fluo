import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

export const nextjsRecipePaths = [
  'packages/platform-nextjs/README.md',
  'packages/platform-nextjs/README.ko.md',
  'book/03-internals/ch15-nextjs-hosting.md',
  'book/03-internals/ch15-nextjs-hosting.ko.md',
  'apps/docs/content/docs/guides/runtime-adapters.mdx',
  'apps/docs/content/docs/guides/runtime-adapters.ko.mdx',
  'apps/docs/content/docs/packages/http-platform.mdx',
  'apps/docs/content/docs/packages/http-platform.ko.mdx',
];

const root = '@fluojs/platform-nextjs';
const exportsByPath = new Map([
  [root, new Set(['NextHttpApplicationAdapter', 'InvalidNextAdapterOptionError',
    'NextAdapterOptions', 'NextAdapterLoader', 'defineNextApplication', 'NextApplicationOptions'])],
  [`${root}/app-router`, new Set(['createNextAppRouterHandler', 'NextAppRouteHandler', 'NextAppRouterMethodHandlers'])],
  [`${root}/pages-router`, new Set(['createNextPagesRouterHandler', 'NextPagesRouterConfig'])],
  [`${root}/next-config`, new Set(['withFluoNextBackend', 'FluoNextBackendOptions'])],
]);

/**
 * Check machine-consumed imports in canonical Next recipe code fences.
 * Migration prose may name removed APIs; runnable snippets must use their owners.
 */
export function enforceNextjsPublicImports(
  readText = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8'),
) {
  for (const path of nextjsRecipePaths) {
    for (const match of readText(path).matchAll(/^```(?:ts|typescript|tsx|js|javascript)\s*\n([\s\S]*?)^```\s*$/gm)) {
      const source = ts.createSourceFile(path, match[1], ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const namespaces = new Map();
      const reject = (name, owner) => {
        throw new Error(`NEXTJS_PUBLIC_IMPORT: ${path}: ${name} is not exported by ${owner}.`);
      };
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const owner = statement.moduleSpecifier.text;
        if (owner !== root && !owner.startsWith(`${root}/`)) continue;
        const allowed = exportsByPath.get(owner);
        if (!allowed) reject('*', owner);
        const clause = statement.importClause;
        if (clause?.name) reject('default', owner);
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          namespaces.set(bindings.name.text, { allowed, owner });
        } else if (bindings && ts.isNamedImports(bindings)) {
          for (const entry of bindings.elements) {
            const name = (entry.propertyName ?? entry.name).text;
            if (!allowed.has(name)) reject(name, owner);
          }
        }
      }
      const visit = (node) => {
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
          const namespace = namespaces.get(node.expression.text);
          if (namespace && !namespace.allowed.has(node.name.text)) reject(node.name.text, namespace.owner);
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
          && node.expression.text === 'createNextAdapter') reject('createNextAdapter', root);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
}
