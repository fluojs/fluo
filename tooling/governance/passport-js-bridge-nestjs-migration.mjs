import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  enforcePassportBridgeExampleAst,
  enforcePassportBridgeSourceAst,
} from './passport-js-bridge-ast.mjs';
import { collectUnsupportedPassportBridgeClaims } from './passport-js-bridge-propositions.mjs';

export { collectUnsupportedPassportBridgeClaims } from './passport-js-bridge-propositions.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationDocuments = [
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
];
const bookDocuments = [
  'book/beginner/ch15-passport.md',
  'book/beginner/ch15-passport.ko.md',
];
const contextDocuments = [
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
];
const requiredMarkers = [
  'createPassportJsStrategyBridge',
  'PassportModule.forRoot',
  'mapPrincipal',
  'requestContext.principal',
  'application-owned',
];

function proseOnly(markdown) {
  return markdown.replace(/```[\s\S]*?```/gu, '');
}

function enforceDocument(relativePath, content) {
  const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));
  if (missingMarkers.length > 0) {
    throw new Error(
      `Passport.js bridge migration contract check failed: ${relativePath} is missing ${missingMarkers.join(', ')}.`,
    );
  }
  const unsupportedClaims = collectUnsupportedPassportBridgeClaims(proseOnly(content));
  if (unsupportedClaims.length > 0) {
    throw new Error(
      `Passport.js bridge migration contract check failed: ${relativePath} contains unsupported claims: ${unsupportedClaims.join(', ')}.`,
    );
  }
}

export function enforcePassportJsBridgeNestjsMigration(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const relativePath of [...migrationDocuments, ...bookDocuments, ...contextDocuments]) {
    enforceDocument(relativePath, readText(relativePath));
  }
  for (const relativePath of [...migrationDocuments, ...bookDocuments]) {
    enforcePassportBridgeExampleAst(relativePath, readText(relativePath));
  }
  enforcePassportBridgeSourceAst(readText);
}
