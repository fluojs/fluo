import ts from 'typescript';

const serviceSourcePath = 'packages/jwt/src/service.ts';
const verifierSourcePath = 'packages/jwt/src/signing/verifier.ts';
const signerSourcePath = 'packages/jwt/src/signing/signer.ts';

function fail(relativePath, message) {
  throw new Error(`JWT verified claims contract check failed: ${relativePath} ${message}.`);
}

function assert(condition, relativePath, message) {
  if (!condition) {
    fail(relativePath, message);
  }
}

function parseSource(relativePath, sourceText) {
  const source = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (source.parseDiagnostics.length > 0) {
    const details = source.parseDiagnostics
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('; ');
    fail(relativePath, `must remain valid TypeScript (${details})`);
  }
  return source;
}

function findMethod(source, className, methodName) {
  let match;

  const visit = (node) => {
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name.getText() === methodName) {
          match = member;
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);

  return match;
}

/**
 * Binds the governed JWT documentation claims to their implementation.
 *
 * The bilingual JWT contract surfaces state that `JwtService.verify(...)` resolves
 * a normalized `JwtPrincipal`, that per-call verification policy is preserved
 * through `verifyAccessToken(token, policy?)`,
 * and that `iat` is filled from the current signing timestamp instead of a module
 * option. This check fails when the implementation drifts away from those claims.
 *
 * @param readText Reads a repository-relative file as UTF-8 text.
 */
export function enforceJwtVerifiedClaimsContract(readText) {
  const serviceSource = parseSource(serviceSourcePath, readText(serviceSourcePath));
  const verify = findMethod(serviceSource, 'JwtService', 'verify');

  assert(verify !== undefined, serviceSourcePath, 'must declare a JwtService.verify method');

  const verifyBody = verify.body?.getText() ?? '';

  assert(
    /return\s+this\.verifier\.verifyAccessToken\(\s*token\s*,\s*options\s*\)/u.test(verifyBody),
    serviceSourcePath,
    'JwtService.verify must return the normalized JwtPrincipal through verifyAccessToken(token, options)',
  );

  const verifierSource = parseSource(verifierSourcePath, readText(verifierSourcePath));
  const verifyAccessToken = findMethod(verifierSource, 'DefaultJwtVerifier', 'verifyAccessToken');

  assert(
    verifyAccessToken !== undefined,
    verifierSourcePath,
    'must declare DefaultJwtVerifier.verifyAccessToken for normalized JwtPrincipal resolution and optional policy',
  );

  const verifyAccessTokenBody = verifyAccessToken?.body?.getText() ?? '';

  for (const option of ['algorithms', 'audience', 'clockSkewSeconds', 'issuer', 'maxAge', 'requireExp']) {
    assert(
      new RegExp(`policy\\?\\.${option}`, 'u').test(verifyAccessTokenBody),
      verifierSourcePath,
      `verifyAccessToken must preserve the per-call ${option} policy`,
    );
  }

  const signerText = readText(signerSourcePath);

  parseSource(signerSourcePath, signerText);

  assert(
    /iat:\s*claims\.iat\s*\?\?\s*now/u.test(signerText),
    signerSourcePath,
    'must fill iat from the current signing timestamp rather than a module option',
  );
}
