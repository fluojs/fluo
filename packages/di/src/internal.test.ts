import { Container } from '@fluojs/di';
import * as diInternal from '@fluojs/di/internal';
import { resolveMultiContribution } from '@fluojs/di/internal';
import { describe, expect, it } from 'vitest';

describe('@fluojs/di/internal multi-contribution resolver', () => {
  it('does not export multi-contribution registration authority', () => {
    // Given
    const exportedNames = Object.keys(diInternal);

    // When
    const hasRegistrar = exportedNames.includes('registerMultiContributionResolver');

    // Then
    expect(hasRegistrar).toBe(false);
  });

  it('resolves contributions through the owning container', async () => {
    // Given
    const token = Symbol('multi-contribution');
    const container = new Container().register(
      { multi: true, provide: token, useValue: 'first' },
      { multi: true, provide: token, useValue: 'second' },
    );

    // When
    const contribution = resolveMultiContribution(container, token, 1);

    // Then
    await expect(contribution).resolves.toBe('second');
  });
});
