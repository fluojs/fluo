import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

function parseMarkdown(text) {
  const blocks = [];
  const plain = [];
  let fence;
  for (const line of text.split('\n')) {
    if (fence) {
      if (new RegExp(`^ {0,3}${fence.character}{${fence.length},}[ \\t]*$`).test(line)) {
        blocks.push({ info: fence.info, code: fence.lines.join('\n') });
        fence = undefined;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (opening) {
      fence = {
        character: opening[1][0],
        length: opening[1].length,
        info: opening[2],
        lines: [],
      };
    } else {
      plain.push(line);
    }
  }
  const prose = plain.join('\n');
  return {
    blocks,
    unclosed: fence !== undefined,
    links: [...prose.matchAll(/\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)].map((match) => match[1]),
    headings: [...prose.matchAll(/^(#{1,6}) /gmu)].map((match) => match[1].length),
  };
}

export function verifyBookSeries(repoRoot, { locale = 'both' } = {}) {
  const root = resolve(repoRoot);
  const locales = locale === 'ko' ? ['ko'] : ['ko', 'en'];
  const issues = [];
  const manifestPath = 'book/series.json';
  if (!existsSync(join(root, manifestPath))) {
    return { chapters: 0, locales, issues: [{ code: 'missing-file', path: manifestPath }] };
  }
  const manifest = JSON.parse(readFileSync(join(root, manifestPath), 'utf8'));
  const counts = [24, 28, 20];
  const valid = manifest?.schemaVersion === 1
    && manifest.originalLanguage === 'ko'
    && Array.isArray(manifest.volumes)
    && manifest.volumes.length === counts.length
    && manifest.volumes.every((volume, index) =>
      typeof volume?.id === 'string'
      && /^\d{2}-[a-z0-9-]+$/u.test(volume.id)
      && Array.isArray(volume.chapters)
      && volume.chapters.length === counts[index]
      && volume.chapters.every((chapter, chapterIndex) =>
        chapter?.number === chapterIndex + 1
        && typeof chapter.slug === 'string'
        && chapter.slug.startsWith(`ch${String(chapter.number).padStart(2, '0')}-`)
        && /^ch\d{2}-[a-z0-9-]+$/u.test(chapter.slug)
        && Array.isArray(chapter.packages)
        && chapter.packages.every((name) => typeof name === 'string' && /^@fluojs\/[a-z0-9.-]+$/u.test(name))),
    )
    && new Set(manifest.volumes.map((volume) => volume.id)).size === counts.length;
  if (!valid) {
    return { chapters: 0, locales, issues: [{ code: 'manifest-shape', path: manifestPath }] };
  }

  const pages = new Map();
  const readPage = (path) => {
    if (!existsSync(join(root, path))) {
      issues.push({ code: 'missing-file', path });
      return undefined;
    }
    const text = readFileSync(join(root, path), 'utf8');
    const parsed = parseMarkdown(text);
    if (parsed.unclosed) issues.push({ code: 'markdown-fence', path });
    pages.set(path, parsed);
    return text;
  };
  const localTarget = (page, target) => {
    if (/^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith('#')) return undefined;
    const pathname = decodeURIComponent(target.split(/[?#]/u)[0]);
    const website = /^\/(en|ko)\/docs(?:\/(.*))?$/u.exec(pathname);
    if (website) {
      const stem = `apps/docs/content/docs/${website[2] ?? 'index'}`;
      const suffix = website[1] === 'ko' ? '.ko.mdx' : '.mdx';
      return join(root, existsSync(join(root, stem + suffix)) ? stem + suffix : `${stem}/index${suffix}`);
    }
    return resolve(dirname(join(root, page)), pathname);
  };

  for (const language of locales) {
    const suffix = language === 'ko' ? '.ko' : '';
    readPage(`book/README${suffix}.md`);
    readPage(`book/EDITORIAL${suffix}.md`);
    for (const volume of manifest.volumes) {
      const directory = `book/${volume.id}`;
      readPage(`${directory}/README${suffix}.md`);
      const tocPath = `${directory}/toc${suffix}.md`;
      readPage(tocPath);
      const expected = volume.chapters.map((chapter) => resolve(root, directory, `${chapter.slug}${suffix}.md`));
      const expectedSet = new Set(expected);
      const toc = pages.get(tocPath);
      if (toc) {
        const order = toc.links.map((target) => localTarget(tocPath, target)).filter((target) => expectedSet.has(target));
        if (JSON.stringify(order) !== JSON.stringify(expected)) {
          issues.push({ code: 'toc-order', path: tocPath });
        }
      }
      for (const chapter of volume.chapters) {
        const path = `${directory}/${chapter.slug}${suffix}.md`;
        const text = readPage(path);
        if (text === undefined) continue;
        const identifiers = [...text.matchAll(/<!-- book:volume=([^;]+);chapter=(\d{2}) -->/gu)];
        if (identifiers.length !== 1
          || identifiers[0][1] !== volume.id
          || Number(identifiers[0][2]) !== chapter.number) {
          issues.push({ code: 'chapter-identity', path });
        }
      }
    }
  }

  for (const [path, page] of pages) {
    for (const target of page.links) {
      const destination = localTarget(path, target);
      if (destination === undefined) continue;
      if (!(destination === root || destination.startsWith(root + sep)) || !existsSync(destination)) {
        issues.push({ code: 'broken-link', path, target });
      }
    }
    if (locale === 'both' && path.endsWith('.ko.md')) {
      const counterpartPath = path.replace(/\.ko\.md$/u, '.md');
      const counterpart = pages.get(counterpartPath);
      if (!counterpart) continue;
      if (JSON.stringify(page.blocks) !== JSON.stringify(counterpart.blocks)) {
        issues.push({ code: 'code-parity', path: counterpartPath });
      }
      if (JSON.stringify(page.headings) !== JSON.stringify(counterpart.headings)) {
        issues.push({ code: 'heading-parity', path: counterpartPath });
      }
    }
  }

  const coveredPackages = new Set(manifest.volumes.flatMap((volume) => volume.chapters.flatMap((chapter) => chapter.packages)));
  for (const name of coveredPackages) {
    const path = `packages/${name.slice('@fluojs/'.length)}/package.json`;
    if (!existsSync(join(root, path))) issues.push({ code: 'unknown-package', path: manifestPath, target: name });
  }
  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    const packagePath = join(root, 'packages', entry.name, 'package.json');
    if (!entry.isDirectory() || !existsSync(packagePath)) continue;
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
    if (pkg.private !== true && pkg.name?.startsWith('@fluojs/') && !coveredPackages.has(pkg.name)) {
      issues.push({ code: 'unmapped-package', path: manifestPath, target: pkg.name });
    }
  }
  return { chapters: counts.reduce((sum, count) => sum + count, 0), locales, issues };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--locale' && ['ko', 'both'].includes(args[1]))) {
    console.error('Usage: node tooling/docs/verify-book-series.mjs [--locale ko|both]');
    process.exitCode = 1;
  } else {
    const result = verifyBookSeries(process.cwd(), { locale: args[1] ?? 'both' });
    for (const issue of result.issues) {
      console.error(JSON.stringify(issue));
    }
    if (result.issues.length > 0) {
      console.error(`Book series verification failed: ${result.issues.length} issue(s).`);
      process.exitCode = 1;
    } else {
      console.log(`Book series verification passed: ${result.chapters} chapters, ${result.locales.join('/')}.`);
    }
  }
}
