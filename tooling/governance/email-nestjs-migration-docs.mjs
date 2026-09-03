import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const emailMigrationMarkerName = 'fluo-email-nestjs-migration';
const emailMigrationMarkerPrefix = `<!-- ${emailMigrationMarkerName}:`;
const emailMigrationMarkerPattern = new RegExp(
  `<!-- ${emailMigrationMarkerName}:\\s*([\\s\\S]*?) -->`,
  'gu',
);

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

function headingBoundedSection(markdown, markerPrefix, relativePath) {
  const headings = [...markdown.matchAll(/^#{1,6}\s.+$/gmu)];
  const sections = headings.map((heading, index) =>
    markdown.slice(heading.index, headings[index + 1]?.index ?? markdown.length),
  );
  const matches = sections.filter((section) => section.includes(markerPrefix));

  assert(matches.length === 1, `${relativePath} must contain exactly one heading-bounded Email migration marker.`);
  return matches[0];
}

function parseMarkerFields(section, relativePath) {
  const markers = [...section.matchAll(emailMigrationMarkerPattern)];
  assert(markers.length === 1, `${relativePath} must contain exactly one Email migration marker.`);

  const fields = new Map();
  for (const rawField of markers[0][1].split(';')) {
    const separator = rawField.indexOf('=');
    assert(
      separator > 0,
      `${relativePath} Email migration marker fields must use key=value syntax.`,
    );

    const key = rawField.slice(0, separator).trim();
    const value = rawField.slice(separator + 1).trim();
    assert(
      key.length > 0 && value.length > 0 && !fields.has(key),
      `${relativePath} Email migration marker has an invalid or duplicate ${key || 'unnamed'} field.`,
    );
    fields.set(key, value);
  }

  return { fields, marker: markers[0][0] };
}

function parseMarkerMappings(fields, fieldName, relativePath) {
  const value = fields.get(fieldName);
  assert(value !== undefined, `${relativePath} Email migration marker is missing ${fieldName}.`);

  const mappings = new Map();
  for (const rawMapping of value.split(',')) {
    const [source, target, extra] = rawMapping.trim().split('->');
    assert(
      source && target && extra === undefined && !mappings.has(source),
      `${relativePath} Email migration ${fieldName} marker must use unique source->target mappings.`,
    );
    mappings.set(source, target);
  }

  return mappings;
}

function assertMarkerMappings(fields, fieldName, expectedMappings, relativePath) {
  const mappings = parseMarkerMappings(fields, fieldName, relativePath);
  assert(
    mappings.size === expectedMappings.length &&
      expectedMappings.every(([source, target]) => mappings.get(source) === target),
    `${relativePath} Email migration ${fieldName} marker has unexpected mappings.`,
  );
}

function parseMarkerValueSet(fields, fieldName, relativePath) {
  const value = fields.get(fieldName);
  assert(value !== undefined, `${relativePath} Email migration marker is missing ${fieldName}.`);

  const values = new Set(value.split(',').map((entry) => entry.trim()));
  assert(
    values.size > 0 && !values.has('') && values.size === value.split(',').length,
    `${relativePath} Email migration ${fieldName} marker must contain unique values.`,
  );
  return values;
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
    const section = headingBoundedSection(
      readText(relativePath),
      emailMigrationMarkerPrefix,
      relativePath,
    );
    const { fields, marker } = parseMarkerFields(section, relativePath);

    assertMarkerMappings(fields, 'async', [['injected-factory', 'supported']], relativePath);
    assertMarkerMappings(
      fields,
      'async-negative',
      [
        ['imports', 'unsupported'],
        ['useClass', 'unsupported'],
        ['useExisting', 'unsupported'],
      ],
      relativePath,
    );
    assertMarkerMappings(
      fields,
      'ownership',
      [
        ['portable', 'application'],
        ['node-factory', 'email-module'],
        ['nodemailer', 'caller'],
      ],
      relativePath,
    );
    assertMarkerMappings(
      fields,
      'delivery',
      [
        ['direct', 'pre-rendered'],
        ['template', 'rendered'],
      ],
      relativePath,
    );
    assertMarkerMappings(
      fields,
      'precedence',
      [
        ['notification.subject', 'rendered.subject'],
        ['payload.text', 'rendered.text'],
        ['payload.html', 'rendered.html'],
        ['payload.to', 'notification.recipients'],
      ],
      relativePath,
    );

    const apiIdentifiers = parseMarkerValueSet(fields, 'api', relativePath);
    const sectionProse = section.replace(marker, '');
    for (const identifier of apiIdentifiers) {
      assert(
        sectionProse.includes(identifier),
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
