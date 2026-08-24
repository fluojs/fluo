import {
  assert,
  hasExactKeys,
  isNonEmptyString,
  isObject,
} from './lane-ledger-contract.mjs';

const sourceV1Keys = ['type', 'search_run_id', 'search_ledger'];
const sourceV2Keys = [...sourceV1Keys, 'artifact_id', 'sha256'];

const isSafeSearchBasename = (value) =>
  isNonEmptyString(value) &&
  /^[A-Za-z0-9][A-Za-z0-9+._-]*$/u.test(value) &&
  !value.endsWith('.') &&
  !value.endsWith('.lock');

export const validateSource = (path, source, version) => {
  const sourceKeys = version === 2 ? sourceV2Keys : sourceV1Keys;
  assert(isObject(source) && hasExactKeys(source, sourceKeys), path, 'source must match a canonical source variant');
  const isExistingIssues = source.type === 'existing-issues' && source.search_run_id === null && source.search_ledger === null;
  const searchLedger =
    version === 1
      ? `.opencode/search-issue/${source.search_run_id}.json`
      : `.omo/search-issue/artifacts/${source.search_run_id}.json`;
  const nativeArtifacts = new Set([
    `.omo/search-issue/artifacts/${source.search_run_id}.json`,
    `.omo/search-issue/artifacts/legacy/${source.search_run_id}.json`,
  ]);
  const sourceMatches =
    source.search_ledger === searchLedger ||
    (version === 1 && nativeArtifacts.has(source.search_ledger)) ||
    (version === 2 && nativeArtifacts.has(source.search_ledger));
  const isSearchIssue =
    source.type === 'search-issue' &&
    isSafeSearchBasename(source.search_run_id) &&
    sourceMatches;
  const hasV2Binding = version !== 2 || (
    source.artifact_id === `search:${String(source.search_run_id)}` &&
    typeof source.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(source.sha256)
  );
  assert(
    (version === 1 && isExistingIssues) || (isSearchIssue && hasV2Binding),
    path,
    'source must match a canonical source variant',
  );
};
