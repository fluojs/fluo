import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const docsRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repoRoot, 'apps/docs/content/docs');

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(file));
    else files.push(file);
  }
  return files;
}

try {
  const files = await collectFiles(docsRoot);
  const translated = files.filter((file) => /\.(en|ko)\.(mdx|json)$/.test(file));
  if (translated.length) {
    console.error('English-only website check failed:');
    for (const file of translated) console.error(`- Remove translated website file: ${path.relative(docsRoot, file)}`);
    process.exitCode = 1;
  } else {
    console.log(`English-only website check passed: ${files.filter((file) => file.endsWith('.mdx')).length} pages.`);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
