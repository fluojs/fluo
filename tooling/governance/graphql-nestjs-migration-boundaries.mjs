import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationMarkerPrefix = '<!-- fluo:graphql-nestjs-migration: ';
const requiredMigrationFacts = {
  'arg-nullability': 'nullable',
  'async-iterable-cleanup': 'application-owned',
  'connection-params': 'untrusted-record',
  'decorator-targets': 'public-instance',
  'endpoint': 'fixed-/graphql',
  'field-resolver': 'code-first',
  'nest-dynamic-module': 'unsupported',
  'nest-path-option': 'unsupported',
  'operation-disposal': 'completion-or-disconnect',
  'output-nullability': 'explicit',
  'parameter-decorators': 'unsupported',
  'principal': 'before-graphql',
  'private-static-targets': 'rejected',
  'resolver-scope': 'request',
  'root-signature': 'input-context',
  'schema-first-field-resolver': 'unsupported',
};
const requiredResolverMigrationFacts = {
  'async-registration': 'inject-use-factory',
  'field-argument-dto': 'code-first-input-args-arg-types',
  'nest-dynamic-options': 'unsupported',
  'schema-first-field-resolver': 'unsupported',
  'subscription-topics': 'unsupported',
};
const migrationDocumentationRequirements = [
  {
    heading: '## GraphQL Migration Boundaries',
    path: 'docs/getting-started/migrate-from-nestjs.md',
  },
  {
    heading: '## GraphQL 마이그레이션 경계',
    path: 'docs/getting-started/migrate-from-nestjs.ko.md',
  },
  {
    heading: '## Resolver Lifecycle Contracts',
    path: 'packages/graphql/README.md',
  },
  {
    heading: '## Resolver Lifecycle 계약',
    path: 'packages/graphql/README.ko.md',
  },
  {
    heading: '### NestJS Migration Boundaries',
    path: 'book/intermediate/ch18-graphql.md',
  },
  {
    heading: '### NestJS 마이그레이션 경계',
    path: 'book/intermediate/ch18-graphql.ko.md',
  },
];
const resolverMigrationDocumentationRequirements = [
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
];
const discoverabilityRequirements = [
  {
    destination: './getting-started/migrate-from-nestjs.md#graphql-migration-boundaries',
    path: 'docs/CONTEXT.md',
  },
  {
    destination: './getting-started/migrate-from-nestjs.ko.md#graphql-마이그레이션-경계',
    path: 'docs/CONTEXT.ko.md',
  },
  {
    destination: '../../docs/getting-started/migrate-from-nestjs.md#graphql-migration-boundaries',
    path: 'packages/graphql/README.md',
  },
  {
    destination: '../../docs/getting-started/migrate-from-nestjs.ko.md#graphql-마이그레이션-경계',
    path: 'packages/graphql/README.ko.md',
  },
];
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Platform consistency governance check failed: ${message}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function renderedMarkdown(content) {
  const withoutComments = content.replace(/<!--[\s\S]*?-->/gu, '');
  const renderedLines = [];
  let fence;

  for (const line of withoutComments.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];

    if (fence === undefined && marker !== undefined) {
      fence = marker;
      continue;
    }

    if (
      fence !== undefined &&
      new RegExp(`^\\s{0,3}${escapeRegExp(fence[0])}{${String(fence.length)},}\\s*$`, 'u').test(line)
    ) {
      fence = undefined;
      continue;
    }

    if (fence === undefined && !/^(?: {4}|\t)/u.test(line)) {
      renderedLines.push(line);
    }
  }

  return renderedLines.join('\n').replace(/(`+)[\s\S]*?\1/gu, '');
}

function extractSection(content, heading, relativePath) {
  const headings = content.split('\n').filter((line) => line === heading);
  assert(
    headings.length === 1,
    `${relativePath} must include exactly one ${heading}; found ${headings.length}.`,
  );

  const start = content.indexOf(heading);
  const headingLevel = /^#+/u.exec(heading)?.[0].length;
  assert(headingLevel !== undefined, `${relativePath} heading ${heading} must be a Markdown heading.`);

  const remainder = content.slice(start + heading.length);
  const nextHeading = new RegExp(`\\n#{1,${headingLevel}}\\s`, 'u').exec(remainder);
  return remainder.slice(0, nextHeading?.index);
}

function parseMigrationFacts(section, relativePath) {
  const markers = [...section.matchAll(/<!-- fluo:graphql-nestjs-migration: ([\s\S]*?) -->/gu)];
  assert(
    markers.length === 1,
    `${relativePath} must include exactly one ${migrationMarkerPrefix}... --> sentinel in its governed section; found ${markers.length}.`,
  );

  const facts = new Map();
  for (const field of markers[0][1].split(';').map((value) => value.trim()).filter(Boolean)) {
    const match = /^(?<name>[a-z][a-z-]*)=(?<value>[a-z0-9][a-z0-9/-]*)$/u.exec(field);
    assert(match?.groups !== undefined, `${relativePath} contains an invalid GraphQL migration sentinel field ${field}.`);
    assert(!facts.has(match.groups.name), `${relativePath} repeats GraphQL migration fact ${match.groups.name}.`);
    facts.set(match.groups.name, match.groups.value);
  }

  const requiredNames = Object.keys(requiredMigrationFacts);
  const unexpectedNames = [...facts.keys()].filter((name) => !(name in requiredMigrationFacts));
  assert(
    unexpectedNames.length === 0,
    `${relativePath} contains unsupported GraphQL migration fact(s): ${unexpectedNames.join(', ')}.`,
  );
  assert(
    facts.size === requiredNames.length,
    `${relativePath} must declare every GraphQL migration fact; found ${facts.size} of ${requiredNames.length}.`,
  );

  for (const [name, value] of Object.entries(requiredMigrationFacts)) {
    assert(
      facts.get(name) === value,
      `${relativePath} must declare GraphQL migration fact ${name}=${value}.`,
    );
  }
}

function parseResolverMigrationFacts(section, relativePath) {
  const markers = [...section.matchAll(/<!-- fluo:graphql-resolver-migration: ([\s\S]*?) -->/gu)];
  assert(
    markers.length === 1,
    `${relativePath} must include exactly one legacy GraphQL resolver migration sentinel; found ${markers.length}.`,
  );

  const facts = new Map();
  for (const field of markers[0][1].split(';').map((value) => value.trim()).filter(Boolean)) {
    const match = /^(?<name>[a-z][a-z-]*)=(?<value>[a-z0-9][a-z0-9/-]*)$/u.exec(field);
    assert(match?.groups !== undefined, `${relativePath} contains an invalid resolver migration fact ${field}.`);
    assert(!facts.has(match.groups.name), `${relativePath} repeats resolver migration fact ${match.groups.name}.`);
    facts.set(match.groups.name, match.groups.value);
  }

  const requiredNames = Object.keys(requiredResolverMigrationFacts);
  const unexpectedNames = [...facts.keys()].filter((name) => !(name in requiredResolverMigrationFacts));
  assert(
    unexpectedNames.length === 0,
    `${relativePath} contains unsupported resolver migration fact(s): ${unexpectedNames.join(', ')}.`,
  );
  assert(
    facts.size === requiredNames.length,
    `${relativePath} must declare every resolver migration fact; found ${facts.size} of ${requiredNames.length}.`,
  );

  for (const [name, value] of Object.entries(requiredResolverMigrationFacts)) {
    assert(
      facts.get(name) === value,
      `${relativePath} must declare resolver migration fact ${name}=${value}.`,
    );
  }
}

function extractLinkDestinations(content) {
  return [...renderedMarkdown(content).matchAll(/\[[^\]\n]+\]\((?<destination>[^)\s]+)(?:\s+["'][^)]*["'])?\)/gu)]
    .map((match) => match.groups?.destination)
    .filter((destination) => destination !== undefined);
}

function enforceDiscoverabilityLink(content, requirement) {
  const destinations = extractLinkDestinations(content);
  const occurrences = destinations.filter((destination) => destination === requirement.destination);
  assert(
    occurrences.length === 1,
    `${requirement.path} must include exactly one canonical GraphQL migration destination ${requirement.destination}; found ${occurrences.length}.`,
  );
}

export function enforceGraphqlNestjsMigrationBoundaries(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const requirement of migrationDocumentationRequirements) {
    const content = readText(requirement.path);
    const section = extractSection(content, requirement.heading, requirement.path);
    parseMigrationFacts(section, requirement.path);
  }

  for (const relativePath of resolverMigrationDocumentationRequirements) {
    parseResolverMigrationFacts(readText(relativePath), relativePath);
  }

  for (const requirement of discoverabilityRequirements) {
    enforceDiscoverabilityLink(readText(requirement.path), requirement);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  enforceGraphqlNestjsMigrationBoundaries();
}
