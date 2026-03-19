import type { Constructor } from '@konekti/core';
import { DefaultValidator as BaseDefaultValidator, DtoValidationError } from '@konekti/dto-validator';

import { BadRequestException, type HttpExceptionDetail } from './exceptions.js';
import type { ValidationIssue, Validator } from './types.js';

function toDetail(issue: ValidationIssue): HttpExceptionDetail {
  return {
    code: issue.code,
    field: issue.field,
    message: issue.message,
    source: issue.source,
  };
}

export class HttpDtoValidationAdapter implements Validator {
  private readonly validator = new BaseDefaultValidator();

  async validate(value: unknown, target: Parameters<BaseDefaultValidator['validate']>[1]): Promise<void> {
    try {
      await this.validator.validate(value, target);
    } catch (error: unknown) {
      if (error instanceof DtoValidationError) {
        throw new BadRequestException(error.message, {
          details: error.issues.map(toDetail),
        });
      }

      throw error;
    }
  }

  async transform<T>(value: unknown, target: Constructor<T>): Promise<T> {
    try {
      return await this.validator.transform(value, target);
    } catch (error: unknown) {
      if (error instanceof DtoValidationError) {
        throw new BadRequestException(error.message, {
          details: error.issues.map(toDetail),
        });
      }

      throw error;
    }
  }
}
