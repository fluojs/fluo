import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), '../..');
const docsRoot = path.join(repoRoot, 'apps/docs/content/docs');
const defaultLocale = 'en';
const translatedLocale = 'ko';

const pageExtension = '.mdx';
const metaFile = 'meta.json';
const localizedMetaFile = `meta.${translatedLocale}.json`;

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function toRelativePortable(filePath) {
  return path.relative(docsRoot, filePath).split(path.sep).join('/');
}

function normalizePage(relativePath) {
  if (!relativePath.endsWith(pageExtension)) {
    return null;
  }

  const withoutExtension = relativePath.slice(0, -pageExtension.length);
  const localizedSuffix = `.${translatedLocale}`;

  if (withoutExtension.endsWith(localizedSuffix)) {
    return {
      locale: translatedLocale,
      slug: withoutExtension.slice(0, -localizedSuffix.length),
    };
  }

  if (withoutExtension.endsWith(`.${defaultLocale}`)) {
    return {
      locale: defaultLocale,
      slug: withoutExtension.slice(0, -`.${defaultLocale}`.length),
    };
  }

  return {
    locale: defaultLocale,
    slug: withoutExtension,
  };
}

function normalizeMeta(relativePath) {
  if (path.basename(relativePath) === metaFile) {
    return {
      locale: defaultLocale,
      slug: path.dirname(relativePath),
    };
  }

  if (path.basename(relativePath) === localizedMetaFile) {
    return {
      locale: translatedLocale,
      slug: path.dirname(relativePath),
    };
  }

  return null;
}

function addSlug(map, slug, relativePath) {
  const existing = map.get(slug) ?? [];
  existing.push(relativePath);
  map.set(slug, existing);
}

function compareMaps(label, englishMap, koreanMap) {
  const failures = [];

  for (const [slug, paths] of englishMap) {
    if (!koreanMap.has(slug)) {
      failures.push(`Missing Korean ${label} for '${slug}' paired with ${paths.join(', ')}`);
    }
  }

  for (const [slug, paths] of koreanMap) {
    if (!englishMap.has(slug)) {
      failures.push(`Missing English ${label} for '${slug}' paired with ${paths.join(', ')}`);
    }
  }

  return failures;
}

async function main() {
  const allFiles = await collectFiles(docsRoot);
  const pages = {
    en: new Map(),
    ko: new Map(),
  };
  const metas = {
    en: new Map(),
    ko: new Map(),
  };

  for (const filePath of allFiles) {
    const relativePath = toRelativePortable(filePath);
    const page = normalizePage(relativePath);

    if (page) {
      addSlug(pages[page.locale], page.slug, relativePath);
      continue;
    }

    const meta = normalizeMeta(relativePath);

    if (meta) {
      const slug = meta.slug === '.' ? '/' : meta.slug;
      addSlug(metas[meta.locale], slug, relativePath);
    }
  }

  const failures = [
    ...compareMaps('page', pages.en, pages.ko),
    ...compareMaps('navigation metadata', metas.en, metas.ko),
  ];

  if (failures.length > 0) {
    console.error('Docs locale parity check failed:');

    for (const failure of failures) {
      console.error(`- ${failure}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log(`Docs locale parity check passed: ${pages.en.size} ${defaultLocale}/${translatedLocale} page pairs and ${metas.en.size} navigation metadata pairs.`);
}

main().catch((error) => {
  console.error('Docs locale parity check crashed.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
