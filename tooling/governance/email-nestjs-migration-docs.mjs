import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const semanticMarker =
  '<!-- fluo-email-nestjs-migration: async=injected-factory-supported;async-negative=imports-useClass-useExisting-unsupported;ownership=portable-application,node-factory-email-module,nodemailer-caller;delivery=direct-pre-rendered,template-rendered;api=EmailModule.forRootAsync,inject,useFactory,global: false,EmailTransport,createNodemailerEmailTransportFactory,createNodemailerEmailTransport,EmailService.send(...),EmailService.sendNotification(...),payload.templateData -->';

const migrationDocuments = [
  'packages/email/README.md',
  'packages/email/README.ko.md',
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
];
const learningPathDocuments = [
  'book/intermediate/ch16-email.md',
  'book/intermediate/ch16-email.ko.md',
];
const learningPathMarker =
  '<!-- fluo-email-nestjs-learning-path: registration=injected-factory;transport-ownership=explicit;delivery=direct-and-template -->';
const contextDocuments = ['docs/CONTEXT.md', 'docs/CONTEXT.ko.md'];
const requiredApiIdentifiers = [
  'EmailModule.forRootAsync',
  'inject',
  'useFactory',
  'global: false',
  'EmailTransport',
  'createNodemailerEmailTransportFactory',
  'createNodemailerEmailTransport',
  'EmailService.send(...)',
  'EmailService.sendNotification(...)',
  'payload.templateData',
];
const requiredContextTargets = [
  'packages/email/README',
  'docs/getting-started/migrate-from-nestjs',
  'book/intermediate/ch16-email',
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function headingBoundedSection(markdown, marker, relativePath) {
  const headings = [...markdown.matchAll(/^#{1,6}\s.+$/gmu)];
  const sections = headings.map((heading, index) =>
    markdown.slice(heading.index, headings[index + 1]?.index ?? markdown.length),
  );
  const matches = sections.filter((section) => section.includes(marker));

  assert(matches.length === 1, `${relativePath} must contain exactly one heading-bounded Email migration marker.`);
  return matches[0];
}

function emailDiscoverabilityRow(markdown, relativePath) {
  const rows = markdown
    .split('\n')
    .filter(
      (line) =>
        line.startsWith('|') &&
        line.includes('@fluojs/email') &&
        line.includes('packages/email/README'),
    );

  assert(rows.length === 1, `${relativePath} must contain exactly one @fluojs/email navigation row.`);
  return rows[0];
}

export function enforceEmailNestjsMigrationDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const relativePath of migrationDocuments) {
    const section = headingBoundedSection(readText(relativePath), semanticMarker, relativePath);

    for (const identifier of requiredApiIdentifiers) {
      assert(
        section.includes(identifier),
        `${relativePath} Email migration section is missing stable API identifier ${identifier}.`,
      );
    }
  }

  for (const relativePath of learningPathDocuments) {
    headingBoundedSection(readText(relativePath), learningPathMarker, relativePath);
  }

  for (const relativePath of contextDocuments) {
    const row = emailDiscoverabilityRow(readText(relativePath), relativePath);

    for (const target of requiredContextTargets) {
      assert(row.includes(target), `${relativePath} @fluojs/email navigation row is missing ${target}.`);
    }
  }
}
