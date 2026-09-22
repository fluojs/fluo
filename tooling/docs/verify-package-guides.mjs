import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(target));
    else files.push(target);
  }
  return files;
}

export async function verifyPackageGuides(repoRoot, { changedFiles = [] } = {}) {
  const root = path.resolve(repoRoot);
  const issues = [];
  const packages = new Map();
  const packageRoot = path.join(root, 'packages');
  for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
    const manifestPath = path.join(packageRoot, entry.name, 'package.json');
    if (!entry.isDirectory() || !existsSync(manifestPath)) continue;
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.name?.startsWith('@fluojs/') && manifest.private !== true) {
      packages.set(manifest.name, `packages/${entry.name}/`);
    }
  }

  const pages = new Map();
  for (const file of await filesUnder(path.join(root, 'apps/docs/content/docs'))) {
    if (!file.endsWith('.mdx')) continue;
    const text = await readFile(file, 'utf8');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
    const name = /^package:\s*["']?(@fluojs\/[^"'\s]+)["']?\s*$/m.exec(frontmatter)?.[1];
    if (!name) continue;
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (!packages.has(name)) issues.push({ code: 'unknown-package', package: name, path: relative });
    if (pages.has(name)) issues.push({ code: 'duplicate-guide', package: name, path: relative });
    pages.set(name, relative);
  }

  const evidence = new Map();
  const fixtureRoot = path.join(root, 'tooling/docs/fixtures/package-guides');
  for (const file of await filesUnder(fixtureRoot)) {
    if (path.basename(file) !== 'evidence.json') continue;
    const entries = JSON.parse(await readFile(file, 'utf8'));
    for (const [name, item] of Object.entries(entries)) {
      if (evidence.has(name)) issues.push({ code: 'duplicate-evidence', package: name });
      if (!packages.has(name)) issues.push({ code: 'unknown-package', package: name, path: file });
      evidence.set(name, item);
    }
  }

  const affected = [];
  for (const [name, prefix] of packages) {
    const page = pages.get(name);
    if (!page) {
      issues.push({ code: 'missing-guide', package: name });
      continue;
    }
    const item = evidence.get(name);
    const fields = ['sources', 'tests', 'compositions', 'verifiedCommands'];
    if (!item || fields.some((field) =>
      !Array.isArray(item[field]) || item[field].length === 0 ||
      item[field].some((value) => typeof value !== 'string' || value.trim() === ''),
    )) {
      issues.push({ code: 'incomplete-evidence', package: name });
    } else {
      if (item.page !== page) issues.push({ code: 'evidence-page-mismatch', package: name });
      for (const source of [...item.sources, ...item.tests]) {
        const absolute = path.resolve(root, source);
        if (!absolute.startsWith(`${root}${path.sep}`) || !existsSync(absolute)) {
          issues.push({ code: 'missing-evidence-path', package: name, path: source });
        }
      }
      if (!item.sources.some((source) => source.startsWith(prefix))) {
        issues.push({ code: 'missing-package-source', package: name });
      }
    }
    if (changedFiles.some((file) => file.startsWith(prefix))) {
      affected.push({ package: name, page, pageChanged: changedFiles.includes(page) });
    }
  }
  return { packages: packages.size, guides: pages.size, affected, issues };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const result = await verifyPackageGuides(root, { changedFiles: process.argv.slice(2) });
  for (const entry of result.affected) {
    console.log(`DOCS_IMPACT ${entry.package} ${entry.page} changed=${entry.pageChanged}`);
  }
  for (const issue of result.issues) console.error(JSON.stringify(issue));
  if (result.issues.length) process.exitCode = 1;
  else console.log(`Package guide coverage passed: ${result.packages} packages, ${result.guides} guides.`);
}
