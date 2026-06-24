import {
  ensureMetadataSymbol,
  getOwnStandardConstructorMetadataBag,
  getStandardMetadataBag,
} from './metadata.js';

export {
  appendClassValidationRule,
  appendDtoFieldValidationRule,
  defineDtoFieldBindingMetadata,
  getClassValidationRules,
  getDtoBindingSchema,
  getDtoFieldBindingMetadata,
  getDtoFieldValidationRules,
  getDtoValidationSchema,
} from './metadata.js';

export type {
  ClassValidationRule,
  CustomClassValidator,
  CustomFieldValidationContext,
  CustomFieldValidator,
  CustomValidationDecoratorOptions,
  DtoBindingSchemaEntry,
  DtoFieldBindingMetadata,
  DtoFieldValidationRule,
  DtoValidationSchemaEntry,
  ValidationDecoratorOptions,
  ValidationIssueMetadata,
  ValidationRuleResult,
} from './metadata.js';

/**
 * Standard metadata bag shape used by first-party request-pipeline integrations.
 */
export type RequestPipelineMetadataBag = Record<PropertyKey, unknown>;

/**
 * Ensure the standard decorator metadata symbol exists for request-pipeline decorators.
 *
 * @returns The active metadata symbol used by fluo metadata helpers.
 */
export function ensureRequestPipelineMetadataSymbol(): symbol {
  return ensureMetadataSymbol();
}

/**
 * Read the effective standard metadata bag for a request-pipeline target.
 *
 * @param target Constructor, prototype, or method owner that may carry standard decorator metadata.
 * @returns The metadata bag when present, otherwise `undefined`.
 */
export function getRequestPipelineMetadataBag(target: object): RequestPipelineMetadataBag | undefined {
  return getStandardMetadataBag(target) as RequestPipelineMetadataBag | undefined;
}

/**
 * Read the standard metadata bag owned directly by a constructor for request-pipeline inheritance walks.
 *
 * @param constructor Constructor whose own standard decorator metadata should be inspected.
 * @returns The own constructor metadata bag when present, otherwise `undefined`.
 */
export function getOwnConstructorRequestPipelineMetadataBag(constructor: Function): RequestPipelineMetadataBag | undefined {
  return getOwnStandardConstructorMetadataBag(constructor) as RequestPipelineMetadataBag | undefined;
}
