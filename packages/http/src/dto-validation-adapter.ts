import { getDtoBindingSchema, type Constructor } from '@konekti/core';
import { DefaultValidator as BaseDefaultValidator, DtoValidationError } from '@konekti/dto';

import { BadRequestException } from './exceptions.js';
import { toInputErrorDetail } from './input-error-detail.js';
import type { ValidationIssue, Validator } from './types.js';

type TransformCapableValidator = {
  transform<T>(value: unknown, target: Constructor<T>): Promise<T>;
};

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
      if (Object.prototype.hasOwnProperty.call(source, binding.propertyKey)) {
        filtered[binding.propertyKey] = source[binding.propertyKey];
      }
    }

    return filtered;
  }

  async validate(value: unknown, target: Parameters<BaseDefaultValidator['validate']>[1]): Promise<void> {
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

  async transform<T>(value: unknown, target: Constructor<T>): Promise<T> {
    try {
      const validator = this.validator as unknown as TransformCapableValidator;
      return await validator.transform(value, target);
    } catch (error: unknown) {
      if (error instanceof DtoValidationError) {
        this.throwBadRequestForValidationError(error);
      }

      throw error;
    }
  }
}
