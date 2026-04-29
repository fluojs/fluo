import { type Constructor } from '@fluojs/core';
import { getDtoBindingSchema } from '@fluojs/core/internal';
import { DefaultValidator as BaseDefaultValidator, DtoValidationError } from '@fluojs/validation';

import { BadRequestException } from '../exceptions.js';
import { toInputErrorDetail } from '../input-error-detail.js';
import type { ValidationIssue, Validator } from '../types.js';

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

  private filterUnboundRequestDtoFields(value: unknown, target: Constructor): unknown {
    if (typeof value !== 'object' || value === null) {
      return value;
    }

    const source = value as Record<PropertyKey, unknown>;
    const filtered: Record<PropertyKey, unknown> = Object.create(Object.getPrototypeOf(value));

    for (const binding of getDtoBindingSchema(target)) {
      if (Object.hasOwn(source, binding.propertyKey)) {
        filtered[binding.propertyKey] = source[binding.propertyKey];
      }
    }

    return filtered;
  }

  async validate(value: unknown, target: Constructor): Promise<void> {
    try {
      const filteredValue = this.filterUnboundRequestDtoFields(value, target);
      await this.validator.validate(filteredValue, target);
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
