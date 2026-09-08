import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const indexPath = 'docs/knowledge-index.json';
const kinds = new Set(['contract', 'recipe', 'package', 'reference', 'migration']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasKeys(value, keys) {
  return isObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRelativePath(path) {
  return typeof path === 'string'
    && path.trim() === path
    && [...path].every((character) => character >= ' ' && character !== '\u007f')
    && !/[\\:#?%]/u.test(path)
    && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export function verifyDocsKnowledge(repoRoot) {
  const root = resolve(repoRoot);
  const issues = [];
  const checkFile = (path) => {
    if (!isRelativePath(path)) {
      issues.push({ code: 'unsafe-path', path: indexPath, target: path });
      return false;
    }
    try {
      const absolute = join(root, path);
      const stat = statSync(absolute, { throwIfNoEntry: false });
      if (!stat) {
        issues.push({ code: 'missing-file', path });
        return false;
      }
      if (!stat.isFile()) {
        issues.push({ code: 'not-file', path });
        return false;
      }
      // A symlink must not disguise a Book owner or evidence outside the checkout.
      if (realpathSync(absolute) !== join(realpathSync(root), path)) {
        issues.push({ code: 'unsafe-path', path });
        return false;
      }
      return true;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error)) throw error;
      issues.push({
        code: ['ENOENT', 'ENOTDIR'].includes(error.code) ? 'missing-file' : 'file-access',
        path,
      });
      return false;
    }
  };
  const readJson = (path) => {
    if (!checkFile(path)) return undefined;
    try {
      return JSON.parse(readFileSync(join(root, path), 'utf8'));
    } catch (error) {
      if (error instanceof SyntaxError) {
        issues.push({ code: 'invalid-json', path });
      } else if (error instanceof Error && 'code' in error) {
        issues.push({ code: 'file-access', path });
      } else {
        throw error;
      }
      return undefined;
    }
  };

  const index = readJson(indexPath);
  if (index === undefined) return { documents: 0, issues };
  if (!hasKeys(index, ['schemaVersion', 'documents']) || index.schemaVersion !== 1 || !Array.isArray(index.documents)) {
    issues.push({ code: 'index-shape', path: indexPath });
    return { documents: 0, issues };
  }

  const publicPackages = new Map();
  const checkPackage = (name) => {
    if (publicPackages.has(name)) return publicPackages.get(name);
    let valid = false;
    if (/^@fluojs\/[a-z0-9][a-z0-9.-]*$/u.test(name)) {
      const path = `packages/${name.slice('@fluojs/'.length)}/package.json`;
      const manifest = readJson(path);
      if (manifest !== undefined) {
        if (!isObject(manifest) || typeof manifest.name !== 'string'
          || (Object.hasOwn(manifest, 'private') && typeof manifest.private !== 'boolean')) {
          issues.push({ code: 'package-shape', path });
        } else {
          valid = manifest.name === name && manifest.private !== true;
        }
      }
    }
    if (!valid) issues.push({ code: 'unknown-package', path: indexPath, target: name });
    publicPackages.set(name, valid);
    return valid;
  };

  const ids = new Set();
  for (const [position, document] of index.documents.entries()) {
    const target = `documents[${position}]`;
    if (!hasKeys(document, ['id', 'kind', 'owner', 'packages', 'sourcePaths', 'testPaths'])
      || typeof document.id !== 'string'
      || !kinds.has(document.kind)
      || !['packages', 'sourcePaths', 'testPaths'].every((field) =>
        Array.isArray(document[field]) && document[field].every((value) => typeof value === 'string'))) {
      issues.push({ code: 'document-shape', path: indexPath, target });
      continue;
    }
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(document.id)) {
      issues.push({ code: 'invalid-id', path: indexPath, target: document.id });
    }
    if (ids.has(document.id)) {
      issues.push({ code: 'duplicate-id', path: indexPath, target: document.id });
    }
    ids.add(document.id);

    for (const name of document.packages) checkPackage(name);
    for (const field of ['sourcePaths', 'testPaths']) {
      if (['contract', 'recipe', 'package'].includes(document.kind) && document[field].length === 0) {
        issues.push({ code: 'empty-evidence', path: indexPath, target: `${target}.${field}` });
      }
      for (const path of document[field]) checkFile(path);
    }

    const owner = document.owner;
    if (!hasKeys(owner, ['en', 'ko']) || typeof owner.en !== 'string' || typeof owner.ko !== 'string') {
      issues.push({ code: 'owner-shape', path: indexPath, target: document.id });
      continue;
    }
    if (!isRelativePath(owner.en) || !isRelativePath(owner.ko)) {
      for (const path of [owner.en, owner.ko]) {
        if (!isRelativePath(path)) issues.push({ code: 'unsafe-path', path: indexPath, target: path });
      }
      continue;
    }
    const packageOwner = /^packages\/([a-z0-9][a-z0-9.-]*)\/README\.md$/u.exec(owner.en);
    const docsOwner = owner.en.startsWith('docs/') && owner.en.endsWith('.md')
      && !/^(?:README|CONTEXT)(?:\.|$)/iu.test(basename(owner.en));
    if (!docsOwner && !packageOwner) {
      issues.push({ code: 'owner-path', path: indexPath, target: owner.en });
      continue;
    }
    // Locale identity comes from paths, not Markdown prose or language detection.
    if (!/^[^.]+\.md$/u.test(basename(owner.en)) || owner.ko !== owner.en.replace(/\.md$/u, '.ko.md')) {
      issues.push({ code: 'owner-locale', path: indexPath, target: document.id });
      continue;
    }
    if (packageOwner) {
      const name = `@fluojs/${packageOwner[1]}`;
      if (!document.packages.includes(name) || !checkPackage(name)) {
        issues.push({ code: 'owner-package', path: indexPath, target: name });
      }
    }
    checkFile(owner.en);
    checkFile(owner.ko);
  }
  return { documents: index.documents.length, issues };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error('Usage: node tooling/docs/verify-docs-knowledge.mjs');
    process.exitCode = 1;
  } else {
    const result = verifyDocsKnowledge(process.cwd());
    for (const issue of result.issues) console.error(JSON.stringify(issue));
    if (result.issues.length > 0) {
      console.error(`Docs knowledge verification failed: ${result.issues.length} issue(s).`);
      process.exitCode = 1;
    } else {
      console.log(`Docs knowledge verification passed: ${result.documents} documents (reference integrity only).`);
    }
  }
}
