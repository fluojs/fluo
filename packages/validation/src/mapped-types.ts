import {
  type Constructor,
  type MetadataPropertyKey,
} from '@konekti/core';
import {
  appendClassValidationRule,
  appendDtoFieldValidationRule,
  defineDtoFieldBindingMetadata,
  getClassValidationRules,
  getDtoBindingSchema,
  getDtoValidationSchema,
} from '@konekti/core/internal';

type DtoConstructor<T = object> = Constructor<T>;

function setClassName(target: Function, name: string): void {
  Object.defineProperty(target, 'name', {
    configurable: true,
    value: name,
  });
}

function createDerivedDto(
  name: string,
  initializer: (instance: Record<PropertyKey, unknown>) => void,
): DtoConstructor {
  class DerivedDto {
    constructor() {
      initializer(this as Record<PropertyKey, unknown>);
    }
  }

  setClassName(DerivedDto, name);
  return DerivedDto;
}

function collectDtoKeys(dto: DtoConstructor): MetadataPropertyKey[] {
  const keys = new Set<MetadataPropertyKey>();

  for (const entry of getDtoBindingSchema(dto)) {
    keys.add(entry.propertyKey);
  }

  for (const entry of getDtoValidationSchema(dto)) {
    keys.add(entry.propertyKey);
  }

  return [...keys];
}

function copyDtoMetadata(
  source: DtoConstructor,
  target: DtoConstructor,
  include: (propertyKey: MetadataPropertyKey) => boolean,
): void {
  for (const entry of getDtoBindingSchema(source)) {
    if (!include(entry.propertyKey)) {
      continue;
    }

    defineDtoFieldBindingMetadata(target.prototype, entry.propertyKey, entry.metadata);
  }

  for (const entry of getDtoValidationSchema(source)) {
    if (!include(entry.propertyKey)) {
      continue;
    }

    for (const rule of entry.rules) {
      appendDtoFieldValidationRule(target.prototype, entry.propertyKey, rule);
    }
  }

  for (const rule of getClassValidationRules(source)) {
    appendClassValidationRule(target, rule);
  }
}

/**
 * Derive a DTO class that keeps only the selected properties from a base DTO.
 *
 * Validation and binding metadata are copied only for the requested keys, which
 * keeps request materialization aligned with the subset contract documented in
 * the base DTO.
 *
 * @typeParam TBase Base DTO constructor to derive from.
 * @typeParam TKey String keys preserved on the derived DTO.
 * @param BaseDto Source DTO that already declares binding and validation metadata.
 * @param keys Property names to keep on the derived DTO.
 * @returns A derived DTO constructor that materializes and validates only the selected fields.
 *
 * @example
 * ```ts
 * class UserDto {
 *   email = '';
 *   name = '';
 * }
 *
 * class UserEmailDto extends PickType(UserDto, ['email']) {}
 * ```
 */
export function PickType<TBase extends DtoConstructor, TKey extends Extract<keyof InstanceType<TBase>, string>>(
  BaseDto: TBase,
  keys: readonly TKey[],
): DtoConstructor<Pick<InstanceType<TBase>, TKey>> {
  const selected = new Set<MetadataPropertyKey>(keys);
  const baseKeys = collectDtoKeys(BaseDto);
  const PickedDto = createDerivedDto(`${BaseDto.name}PickType`, (instance) => {
    for (const key of baseKeys) {
      if (selected.has(key)) {
        instance[key] = undefined;
      }
    }
  });

  copyDtoMetadata(BaseDto, PickedDto, (propertyKey) => selected.has(propertyKey));

  return PickedDto as DtoConstructor<Pick<InstanceType<TBase>, TKey>>;
}

/**
 * Derive a DTO class that removes specific properties from a base DTO.
 *
 * Binding and validation metadata for omitted properties are intentionally not
 * copied, so downstream transports cannot bind or validate those fields on the
 * derived contract.
 *
 * @typeParam TBase Base DTO constructor to derive from.
 * @typeParam TKey String keys removed from the derived DTO.
 * @param BaseDto Source DTO that already declares binding and validation metadata.
 * @param keys Property names to exclude from the derived DTO.
 * @returns A derived DTO constructor that preserves every base field except the omitted keys.
 *
 * @example
 * ```ts
 * class UserDto {
 *   id = '';
 *   passwordHash = '';
 * }
 *
 * class PublicUserDto extends OmitType(UserDto, ['passwordHash']) {}
 * ```
 */
export function OmitType<TBase extends DtoConstructor, TKey extends Extract<keyof InstanceType<TBase>, string>>(
  BaseDto: TBase,
  keys: readonly TKey[],
): DtoConstructor<Omit<InstanceType<TBase>, TKey>> {
  const omitted = new Set<MetadataPropertyKey>(keys);
  const baseKeys = collectDtoKeys(BaseDto);
  const OmittedDto = createDerivedDto(`${BaseDto.name}OmitType`, (instance) => {
    for (const key of baseKeys) {
      if (!omitted.has(key)) {
        instance[key] = undefined;
      }
    }
  });

  copyDtoMetadata(BaseDto, OmittedDto, (propertyKey) => !omitted.has(propertyKey));

  return OmittedDto as DtoConstructor<Omit<InstanceType<TBase>, TKey>>;
}

type UnionToIntersection<T> = (
  T extends unknown ? (value: T) => void : never
) extends (value: infer TResult) => void ? TResult : never;

type IntersectionInstance<TBaseDtos extends readonly DtoConstructor[]> = UnionToIntersection<InstanceType<TBaseDtos[number]>>;

/**
 * Combine multiple DTO classes into one intersection DTO.
 *
 * The derived constructor initializes every property discovered across the
 * source DTOs and copies each source DTO's binding and validation metadata.
 *
 * @typeParam TBaseDtos Tuple of DTO constructors to merge.
 * @param baseDtos DTO constructors whose fields and rules should be combined.
 * @returns A DTO constructor whose instance type is the intersection of every input DTO.
 *
 * @example
 * ```ts
 * class PaginationDto {
 *   page = 1;
 * }
 *
 * class SearchDto {
 *   query = '';
 * }
 *
 * class SearchPageDto extends IntersectionType(PaginationDto, SearchDto) {}
 * ```
 */
export function IntersectionType<TBaseDtos extends readonly [DtoConstructor, DtoConstructor, ...DtoConstructor[]]>(
  ...baseDtos: TBaseDtos
): DtoConstructor<IntersectionInstance<TBaseDtos>> {
  const baseKeySets = baseDtos.map((dto) => collectDtoKeys(dto));
  const IntersectionDto = createDerivedDto(
    `${baseDtos.map((dto) => dto.name).join('') || 'Anonymous'}IntersectionType`,
    (instance) => {
      for (const baseKeys of baseKeySets) {
        for (const key of baseKeys) {
          instance[key] = undefined;
        }
      }
    },
  );

  for (const BaseDto of baseDtos) {
    copyDtoMetadata(BaseDto, IntersectionDto, () => true);
  }

  return IntersectionDto as DtoConstructor<IntersectionInstance<TBaseDtos>>;
}

/**
 * Derive a DTO class where every bound field from the base DTO becomes optional.
 *
 * Existing validators are preserved, and an `optional` validation rule is added
 * when the base field did not already declare one.
 *
 * @typeParam TBase Base DTO constructor to derive from.
 * @param BaseDto Source DTO that defines the original field contract.
 * @returns A derived DTO constructor suited for patch/update style payloads.
 *
 * @example
 * ```ts
 * class CreateUserDto {
 *   email = '';
 *   name = '';
 * }
 *
 * class UpdateUserDto extends PartialType(CreateUserDto) {}
 * ```
 */
export function PartialType<TBase extends DtoConstructor>(BaseDto: TBase): DtoConstructor<Partial<InstanceType<TBase>>> {
  const baseKeys = collectDtoKeys(BaseDto);
  const PartialDto = createDerivedDto(`${BaseDto.name}PartialType`, (instance) => {
    for (const key of baseKeys) {
      instance[key] = undefined;
    }
  });

  for (const entry of getDtoBindingSchema(BaseDto)) {
    defineDtoFieldBindingMetadata(PartialDto.prototype, entry.propertyKey, {
      ...entry.metadata,
      optional: true,
    });
  }

  const validationSchema = getDtoValidationSchema(BaseDto);

  for (const entry of validationSchema) {
    const hasOptional = entry.rules.some((rule) => rule.kind === 'optional');

    for (const rule of entry.rules) {
      appendDtoFieldValidationRule(PartialDto.prototype, entry.propertyKey, rule);
    }

    if (!hasOptional) {
      appendDtoFieldValidationRule(PartialDto.prototype, entry.propertyKey, { kind: 'optional' });
    }
  }

  for (const rule of getClassValidationRules(BaseDto)) {
    appendClassValidationRule(PartialDto, rule);
  }

  return PartialDto as DtoConstructor<Partial<InstanceType<TBase>>>;
}
