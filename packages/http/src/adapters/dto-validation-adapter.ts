import { type Constructor } from '@fluojs/core';
import { DefaultValidator as BaseDefaultValidator, DtoValidationError } from '@fluojs/validation';

import { BadRequestException } from '../exceptions.js';
import { toInputErrorDetail } from '../input-error-detail.js';
import type { ValidationIssue, Validator } from '../types.js';
import { getCompiledDtoBindingPlan } from './dto-binding-plan.js';

/**
 * Represents the http dto validation adapter.
 */
export class HttpDtoValidationAdapter implements Validator {
  private readonly validator = new BaseDefaultValidator();

  private throwBadRequestForValidationError(error: DtoValidationError): never {
    throw new BadRequestException(error.message, {
      details: error.issues.map((issue: ValidationIssue) => toInputErrorDetail(issue)),
    });
  }

  async validate(value: unknown, target: Constructor): Promise<void> {
    try {
      const plan = getCompiledDtoBindingPlan(target);

      if (!plan.needsValidation) {
        return;
      }

      await this.validator.validate(plan.toValidationValue(value), target);
    } catch (error: unknown) {
      if (error instanceof DtoValidationError) {
        this.throwBadRequestForValidationError(error);
      }

      throw error;
    }
  }

  async materialize<T>(value: unknown, target: Constructor<T>): Promise<T> {
    try {
      return await this.validator.materialize(value, target);
    } catch (error: unknown) {
      if (error instanceof DtoValidationError) {
        this.throwBadRequestForValidationError(error);
      }

      throw error;
    }
  }
}
