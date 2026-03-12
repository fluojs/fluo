import type { Constructor } from '@konekti/core';

import { BadRequestException, type HttpExceptionDetail } from './exceptions';
import type { ValidationAdapter, ValidationIssue, Validator } from './types';

interface StaticValidatorTarget<T = unknown> extends Constructor<T> {
  validate?(value: T): Promise<readonly ValidationIssue[] | void> | readonly ValidationIssue[] | void;
  validator?: ValidationAdapter<T>;
}

function toDetail(issue: ValidationIssue): HttpExceptionDetail {
  return {
    code: issue.code,
    field: issue.field,
    message: issue.message,
    source: issue.source,
  };
}

async function collectValidationIssues<T>(target: StaticValidatorTarget<T>, value: T): Promise<readonly ValidationIssue[]> {
  if (target.validator) {
    return (await target.validator.validate(value)) ?? [];
  }

  if (typeof target.validate === 'function') {
    return (await target.validate(value)) ?? [];
  }

  return [];
}

export class DefaultValidator implements Validator {
  async validate(value: unknown, target: Constructor): Promise<void> {
    const issues = await collectValidationIssues(target as StaticValidatorTarget, value);

    if (issues.length === 0) {
      return;
    }

    throw new BadRequestException('Validation failed.', {
      details: issues.map(toDetail),
    });
  }
}
