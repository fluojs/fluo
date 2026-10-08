import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const packagesRoot = fileURLToPath(new URL('../../', import.meta.url));
const owners = ['auth', 'auth-http', 'core', 'di', 'http', 'jwt', 'passport', 'runtime'];

function sourceDependencies(directory: string): Set<string> {
  const dependencies = new Set<string>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const dependency of sourceDependencies(path)) dependencies.add(dependency);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
      for (const statement of source.statements) {
        if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
          && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
          const specifier = statement.moduleSpecifier.text;
          if (specifier.startsWith('@fluojs/')) dependencies.add(specifier.split('/')[1]);
        }
      }
    }
  }
  return dependencies;
}

function assertAcyclic(graph: Map<string, Set<string>>): void {
  const visited = new Set<string>();
  const visit = (owner: string, ancestry: string[]) => {
    expect(ancestry, `Package cycle through ${owner}`).not.toContain(owner);
    if (visited.has(owner)) return;
    for (const dependency of graph.get(owner) ?? []) {
      if (graph.has(dependency) && dependency !== owner) visit(dependency, [...ancestry, owner]);
    }
    visited.add(owner);
  };
  for (const owner of graph.keys()) visit(owner, []);
}

describe('neutral auth boundary', () => {
  it('loads the built public root when concrete integrations are forbidden', () => {
    const loader = new URL('../test/reject-integration-loader.mjs', import.meta.url);
    const result = spawnSync(process.execPath, [
      '--loader', loader.href, '--input-type=module', '--eval',
      "const auth = await import('@fluojs/auth'); if (typeof auth.resolveAccountLinking !== 'function') throw Error('missing public policy');",
    ], { cwd: packageRoot, encoding: 'utf8' });

    expect(result.status, result.stderr).toBe(0);
  });

  it('keeps source and published dependency directions acyclic', () => {
    const sources = new Map<string, Set<string>>();
    const manifests = new Map<string, Set<string>>();
    for (const owner of owners) {
      const manifest = JSON.parse(readFileSync(join(packagesRoot, owner, 'package.json'), 'utf8'));
      manifests.set(owner, new Set(Object.keys(manifest.dependencies ?? {}).map((name) => name.split('/')[1])));
      sources.set(owner, sourceDependencies(join(packagesRoot, owner, 'src')));
    }

    expect([...manifests.get('auth') ?? []]).toEqual(['core']);
    expect([...sources.get('auth') ?? []]).toEqual(['core']);
    assertAcyclic(manifests);
    assertAcyclic(sources);
  });
});
