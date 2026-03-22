import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), 'templates');
const templateCache = new Map<string, string>();

export function renderTemplate(templateName: string, vars: Record<string, unknown>): string {
  const templatePath = join(templatesDir, templateName);
  let template = templateCache.get(templatePath);

  if (!template) {
    template = readFileSync(templatePath, 'utf8');
    templateCache.set(templatePath, template);
  }

  return ejs.render(template, vars, { escape: (s: unknown) => String(s) });
}
