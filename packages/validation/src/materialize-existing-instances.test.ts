import { describe, expect, it } from 'vitest';

import { MinLength, ValidateNested } from './decorators.js';
import { DefaultValidator } from './validation.js';

class AddressDto {
  @MinLength(1)
  city = '';
}

class ExistingOrderDto {
  @ValidateNested(() => AddressDto)
  address: AddressDto | { city: string } = new AddressDto();
}

class CountryDto {
  @MinLength(2)
  code = '';
}

class ExistingAddressDto {
  @ValidateNested(() => CountryDto)
  country: CountryDto | { code: string } = new CountryDto();
}

class ExistingCustomerDto {
  @ValidateNested(() => ExistingAddressDto)
  address = new ExistingAddressDto();
}

class ExistingCollectionDto {
  @ValidateNested(() => AddressDto)
  addressArray: Array<AddressDto | { city: string }> = [];

  @ValidateNested(() => AddressDto)
  addressSet = new Set<AddressDto | { city: string }>();

  @ValidateNested(() => AddressDto)
  addressMap = new Map<string, AddressDto | { city: string }>();
}

describe('DefaultValidator existing-instance contract', () => {
  it('hydrates a plain nested DTO while preserving the existing root identity', async () => {
    // Given
    const input = Object.assign(new ExistingOrderDto(), { address: { city: 'Seoul' } });
    const validator = new DefaultValidator();

    // When
    const result = await validator.materialize<ExistingOrderDto>(input, ExistingOrderDto);

    // Then
    expect(result).toBe(input);
    expect(result.address).toBeInstanceOf(AddressDto);
    expect(result.address.city).toBe('Seoul');
  });

  it('hydrates descendants while preserving an existing nested DTO identity', async () => {
    // Given
    const existingAddress = Object.assign(new ExistingAddressDto(), { country: { code: 'KR' } });
    const input = Object.assign(new ExistingCustomerDto(), { address: existingAddress });
    const validator = new DefaultValidator();

    // When
    const result = await validator.materialize<ExistingCustomerDto>(input, ExistingCustomerDto);

    // Then
    expect(result.address).toBe(existingAddress);
    expect(result.address.country).toBeInstanceOf(CountryDto);
  });

  it('does not replace plain descendants during validation-only checks', async () => {
    // Given
    const country = { code: 'KR' };
    const existingAddress = Object.assign(new ExistingAddressDto(), { country });
    const input = Object.assign(new ExistingCustomerDto(), { address: existingAddress });
    const validator = new DefaultValidator();

    // When
    await validator.validate(input, ExistingCustomerDto);

    // Then
    expect(existingAddress.country).toBe(country);
    expect(existingAddress.country).not.toBeInstanceOf(CountryDto);
  });

  it('hydrates plain array members on an existing root instance', async () => {
    // Given
    const input = Object.assign(new ExistingCollectionDto(), { addressArray: [{ city: 'Seoul' }] });
    const validator = new DefaultValidator();

    // When
    const result = await validator.materialize<ExistingCollectionDto>(input, ExistingCollectionDto);

    // Then
    expect(result.addressArray[0]).toBeInstanceOf(AddressDto);
  });

  it('hydrates plain Set members on an existing root instance', async () => {
    // Given
    const input = Object.assign(new ExistingCollectionDto(), { addressSet: new Set([{ city: 'Seoul' }]) });
    const validator = new DefaultValidator();

    // When
    const result = await validator.materialize<ExistingCollectionDto>(input, ExistingCollectionDto);

    // Then
    expect(Array.from(result.addressSet)[0]).toBeInstanceOf(AddressDto);
  });

  it('hydrates plain Map members on an existing root instance', async () => {
    // Given
    const input = Object.assign(new ExistingCollectionDto(), { addressMap: new Map([['home', { city: 'Seoul' }]]) });
    const validator = new DefaultValidator();

    // When
    const result = await validator.materialize<ExistingCollectionDto>(input, ExistingCollectionDto);

    // Then
    expect(result.addressMap.get('home')).toBeInstanceOf(AddressDto);
  });
});
