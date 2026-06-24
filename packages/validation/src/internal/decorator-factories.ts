import type { DtoFieldValidationRule, ValidationDecoratorOptions } from '@fluojs/core/request-pipeline';

import { appendStandardDtoValidationRule, type FieldDecoratorFn } from './decorator-metadata.js';

type ValidatorJsRuleName = Extract<DtoFieldValidationRule, { kind: 'validatorjs' }>['validator'];

export function createValidationDecorator(ruleFactory: () => DtoFieldValidationRule): FieldDecoratorFn {
  const decorator = <This, Value>(_value: undefined, context: ClassFieldDecoratorContext<This, Value>) => {
    appendStandardDtoValidationRule(context.metadata, context.name, ruleFactory());
  };

  return decorator as FieldDecoratorFn;
}

export function createValidationOptionsWithConfigDecorator<T>(
  ruleFactory: (value: T, options: ValidationDecoratorOptions | undefined) => DtoFieldValidationRule,
) {
  return (value: T, options?: ValidationDecoratorOptions): FieldDecoratorFn => {
    return createValidationDecorator(() => ruleFactory(value, options));
  };
}

export function createFlagValidationDecorator(
  ruleFactory: (options: ValidationDecoratorOptions | undefined) => DtoFieldValidationRule,
) {
  return (options?: ValidationDecoratorOptions): FieldDecoratorFn => {
    return createValidationDecorator(() => ruleFactory(options));
  };
}

export function createArrayValidationDecorator<T>(
  ruleFactory: (values: readonly T[], options: ValidationDecoratorOptions | undefined) => DtoFieldValidationRule,
) {
  return (values: readonly T[], options?: ValidationDecoratorOptions): FieldDecoratorFn => {
    return createValidationDecorator(() => ruleFactory(values, options));
  };
}

export function createValidatorJsDecorator(validator: ValidatorJsRuleName) {
  return (args?: readonly unknown[], options?: ValidationDecoratorOptions): FieldDecoratorFn => {
    return createValidationDecorator(() => ({
      args,
      kind: 'validatorjs',
      validator,
      ...options,
    }));
  };
}
