import type { Constructor } from '@konekti/core';
import { DefaultValidator as BaseDefaultValidator, DtoValidationError } from '@konekti/dto-validator';

import { BadRequestException } from './exceptions.js';
import { toInputErrorDetail } from './input-error-detail.js';
import type { ValidationIssue, Validator } from './types.js';

export class HttpDtoValidationAdapter implements Validator {
  private readonly validator = new BaseDefaultValidator();

  async validate(value: unknown, target: Parameters<BaseDefaultValidator['validate']>[1]): Promise<void> {
    try {
      await this.validator.validate(value, target);
    } catch (error: unknown) {
      if (error instanceof DtoValidationError) {
        throw new BadRequestException(error.message, {
          details: error.issues.map((issue: ValidationIssue) => toInputErrorDetail(issue)),
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
          details: error.issues.map((issue: ValidationIssue) => toInputErrorDetail(issue)),
        });
      }

      throw error;
    }
  }
}
