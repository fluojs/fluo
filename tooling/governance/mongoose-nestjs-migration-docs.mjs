import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const contractFields = [
  'application-owned-connection',
  'ambient-session-merge',
  'preserves-operation-options',
  'strict-fail-open',
  'explicit-target',
];
const contractMarkerPatterns = [
  /^<!-- fluo-mongoose-contract: ([a-z-]+(?:, [a-z-]+)*) -->$/gmu,
  /^\{\/\* fluo-mongoose-contract: ([a-z-]+(?:, [a-z-]+)*) \*\/\}$/gmu,
];
const documentationRequirements = [
  {
    heading: '## Mongoose Root and Feature Migration',
    path: 'docs/getting-started/migrate-from-nestjs.md',
    requiresExplicitDiExample: true,
  },
  {
    heading: '## Mongoose 루트와 feature 마이그레이션',
    path: 'docs/getting-started/migrate-from-nestjs.ko.md',
    requiresExplicitDiExample: true,
  },
  {
    heading: '## Context Resolution Rules',
    path: 'docs/architecture/transactions.md',
  },
  {
    heading: '## 문맥 해석 규칙',
    path: 'docs/architecture/transactions.ko.md',
  },
  {
    heading: '## Migration Reference',
    path: 'docs/CONTEXT.md',
  },
  {
    heading: '## Migration Reference',
    path: 'docs/CONTEXT.ko.md',
  },
  {
    heading: '# @fluojs/mongoose',
    path: 'packages/mongoose/README.md',
    requiresExplicitDiExample: true,
  },
  {
    heading: '# @fluojs/mongoose',
    path: 'packages/mongoose/README.ko.md',
    requiresExplicitDiExample: true,
  },
  {
    heading: '## Mongoose',
    path: 'apps/docs/content/docs/guides/persistence.mdx',
  },
  {
    heading: '## Mongoose',
    path: 'apps/docs/content/docs/guides/persistence.ko.mdx',
  },
  {
    heading: '# Chapter 19. MongoDB and Mongoose',
    path: 'book/intermediate/ch19-mongoose.md',
  },
  {
    heading: '# Chapter 19. MongoDB and Mongoose',
    path: 'book/intermediate/ch19-mongoose.ko.md',
  },
];
const saveDocumentContractMarker =
  '<!-- fluo-mongoose-save-document-contract: opt-in, active-session, save-compatible-document -->';
const saveDocumentRequirements = [
  {
    path: 'packages/mongoose/README.md',
    typeConstraint: '  save(options?: UserDocumentSaveOptions): Promise<UserDocument>;',
  },
  {
    path: 'packages/mongoose/README.ko.md',
    typeConstraint: '  save(options?: UserDocumentSaveOptions): Promise<UserDocument>;',
  },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Platform consistency governance check failed: ${message}`);
  }
}

function enforceUniqueLine(content, line, relativePath) {
  const matches = content.split('\n').filter((candidate) => candidate === line);
  assert(
    matches.length === 1,
    `${relativePath} must include exactly one ${line}; found ${matches.length}.`,
  );
}

function enforceMongooseContractMarker(content, relativePath) {
  const markers = contractMarkerPatterns.flatMap((pattern) => [...content.matchAll(pattern)]);
  assert(
    markers.length === 1,
    `${relativePath} must include exactly one fluo-mongoose-contract marker; found ${markers.length}.`,
  );

  const fields = markers[0][1].split(', ');
  assert(
    fields.length === contractFields.length &&
      new Set(fields).size === contractFields.length &&
      contractFields.every((field) => fields.includes(field)),
    `${relativePath} must declare each machine-consumed Mongoose contract field exactly once.`,
  );
}

function enforceExplicitDiExample(content, relativePath) {
  const examples = [...content.matchAll(/```(?:ts|typescript)\s*\n([\s\S]*?)```/gu)]
    .map((match) => match[1] ?? '')
    .filter((example) => example.includes('class UserRepository') && example.includes('class UserService'));
  assert(
    examples.length === 1,
    `${relativePath} must include exactly one fenced UserRepository/UserService migration example.`,
  );

  const example = examples[0];
  const repositoryMatches = [
    ...example.matchAll(/@Inject\(MongooseConnection\)\s*\n(?:export\s+)?class UserRepository\b/gu),
  ];
  const serviceMatches = [
    ...example.matchAll(/@Inject\(UserRepository\)\s*\n(?:export\s+)?class UserService\b/gu),
  ];
  assert(
    repositoryMatches.length === 1 && serviceMatches.length === 1,
    `${relativePath} must declare explicit MongooseConnection and UserRepository constructor tokens.`,
  );
  assert(
    (repositoryMatches[0].index ?? 0) < (serviceMatches[0].index ?? 0),
    `${relativePath} must declare UserRepository before UserService references its token.`,
  );
}

function enforceSaveDocumentContract(content, requirement) {
  enforceUniqueLine(content, saveDocumentContractMarker, requirement.path);
  const typeConstraints = content
    .split('\n')
    .filter((candidate) => candidate === requirement.typeConstraint);
  assert(
    typeConstraints.length === 1,
    `${requirement.path} must include exactly one save-compatible document type constraint; found ${typeConstraints.length}.`,
  );
}

export function enforceMongooseNestjsMigrationDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const requirement of documentationRequirements) {
    const content = readText(requirement.path);
    enforceMongooseContractMarker(content, requirement.path);
    enforceUniqueLine(content, requirement.heading, requirement.path);

    if (requirement.requiresExplicitDiExample) {
      enforceExplicitDiExample(content, requirement.path);
    }
  }

  for (const requirement of saveDocumentRequirements) {
    enforceSaveDocumentContract(readText(requirement.path), requirement);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  enforceMongooseNestjsMigrationDocs();
}
