import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), 'templates');

export function renderTemplate(templateName: string, vars: Record<string, unknown>): string {
  const template = readFileSync(join(templatesDir, templateName), 'utf8');
  return ejs.render(template, vars, { escape: (s) => String(s) });
}
