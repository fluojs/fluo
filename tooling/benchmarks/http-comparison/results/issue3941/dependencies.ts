import { createHash } from 'node:crypto';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Capture the actual resolved runtime closure, including linked package dist. */
export class Issue3941Dependencies {
  static async files(directory: string): Promise<string[]> {
    const paths: string[] = [];
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) paths.push(...await Issue3941Dependencies.files(path));
      else if (entry.isFile()) paths.push(path);
    }
    return paths;
  }

  static async capture(entry: string, names: readonly string[]) {
    const seen = new Set<string>();
    const paths = new Set<string>();
    const visit = async (from: string, name: string): Promise<void> => {
      let parent = dirname(from);
      while (parent !== dirname(parent)) {
        try {
          const directory = await realpath(join(parent, 'node_modules', name));
          const path = join(directory, 'package.json');
          const manifest: { name?: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string> } =
            JSON.parse(await readFile(path, 'utf8'));
          if (manifest.name === name) {
            if (seen.has(directory)) return;
            seen.add(directory);
            for (const file of await Issue3941Dependencies.files(directory)) paths.add(file);
            for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }).sort()) {
              await visit(join(directory, 'package.json'), dependency);
            }
            return;
          }
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        }
        parent = dirname(parent);
      }
      throw new TypeError(`Missing resolved dependency manifest: ${name}`);
    };
    for (const name of names) await visit(entry, name);
    return Object.fromEntries(await Promise.all([...paths].sort().map(async (path) =>
      [path, createHash('sha256').update(await readFile(path)).digest('hex')] as const)));
  }

  static digest(artifacts: Readonly<Record<string, string>>, directory: string): string {
    // Normalize the deployment directory; byte hashes still come from actual files.
    const rows = Object.entries(artifacts).map(([path, hash]) => [path.startsWith(`${directory}/`) ? path.slice(directory.length + 1) : path, hash]);
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
}
