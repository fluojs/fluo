import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { DEFAULT_BOOTSTRAP_SCHEMA } from './resolver.js';
import { scaffoldBootstrapApp } from './scaffold.js';

describe('canonical Node HTTP starter boundary', () => {
  it.each(['fastify', 'express', 'nodejs'] as const)('creates %s applications through Factory with explicit Node signal ownership', async (platform) => {
    // Given
    const targetDirectory = await mkdtemp(join(tmpdir(), 'fluo-factory-starter-'));
    try {
      await scaffoldBootstrapApp({
        ...DEFAULT_BOOTSTRAP_SCHEMA,
        packageManager: 'pnpm',
        platform,
        projectName: 'factory-starter',
        skipInstall: true,
        targetDirectory,
      });
      // When
      const source = await readFile(join(targetDirectory, 'src/main.ts'), 'utf8');
      const file = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
      const calls: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) calls.push(node.expression.getText(file));
        ts.forEachChild(node, visit);
      };
      visit(file);
      const manifest = JSON.parse(await readFile(join(targetDirectory, 'package.json'), 'utf8'));
      // Then
      expect(calls.filter((name) => name === 'FluoFactory.create')).toHaveLength(1);
      expect(calls.filter((name) => name === 'app.listen')).toHaveLength(1);
      expect(calls).toContain('createNodeShutdownSignalRegistration');
      expect(calls.filter((name) => /^run.*Application$/.test(name))).toEqual([]);
      expect(manifest.dependencies).toHaveProperty('@fluojs/platform-nodejs');
    } finally {
      await rm(targetDirectory, { recursive: true, force: true });
    }
  });
});
