import type { ValidationIssueMetadata, ValidationRuleResult } from '@fluojs/core/request-pipeline';

import type { ValidationIssue } from '../types.js';

function normalizeIssue(
  issue: ValidationIssueMetadata,
  field: string | undefined,
  source: ValidationIssue['source'],
): ValidationIssue {
  return {
    code: issue.code,
    field: issue.field ?? field,
    message: issue.message,
    source: issue.source ?? source,
  };
}

export function normalizeResult(
  result: ValidationRuleResult,
  field: string | undefined,
  source: ValidationIssue['source'],
  fallback: { readonly code: string; readonly message: string },
): ValidationIssue[] {
  if (result === undefined || result === true) {
    return [];
  }

  if (result === false) {
    return [{ code: fallback.code, field, message: fallback.message, source }];
  }

  if (Array.isArray(result)) {
    return result.map((issue) => normalizeIssue(issue, field, source));
  }

  return [normalizeIssue(result as ValidationIssueMetadata, field, source)];
}

export function joinFieldPath(parent: string, child?: string): string {
  if (!child) return parent;
  return child.startsWith('[') ? `${parent}${child}` : `${parent}.${child}`;
}

export function prefixIssues(
  issues: readonly ValidationIssue[],
  fieldPrefix: string,
  source: ValidationIssue['source'],
): ValidationIssue[] {
  return issues.map((issue) => ({ ...issue, field: joinFieldPath(fieldPrefix, issue.field), source: issue.source ?? source }));
}

export function buildIssue(
  fallback: { readonly code: string; readonly message: string },
  field: string,
  source: ValidationIssue['source'],
): ValidationIssue {
  return {
    code: fallback.code,
    field,
    message: fallback.message,
    source,
  };
}
