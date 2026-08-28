import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const intakeContracts = await import(
  resolve(
    root,
    '.agents/skills/create-lane/scripts/intake-contracts.mjs',
  )
);

const parseInvocation: unknown = Reflect.get(
  intakeContracts,
  'parseCreateLaneInvocation',
);

describe('$create-lane invocation', () => {
  it('keeps related issue recommendations disabled by default', () => {
    // Given
    const args = ['4101', '4102'];

    // When / Then
    expect(typeof parseInvocation).toBe('function');
    if (typeof parseInvocation !== 'function') {
      return;
    }
    expect(parseInvocation(args)).toEqual({
      mode: 'issue-numbers',
      issue_numbers: [4101, 4102],
      recommend_issues: false,
    });
  });

  it('enables recommendations with the trailing long flag', () => {
    // Given
    const args = ['4101', '4102', '--recommend-issues'];

    // When / Then
    expect(typeof parseInvocation).toBe('function');
    if (typeof parseInvocation !== 'function') {
      return;
    }
    expect(parseInvocation(args)).toEqual({
      mode: 'issue-numbers',
      issue_numbers: [4101, 4102],
      recommend_issues: true,
    });
  });

  it('enables recommendations with the trailing short flag', () => {
    // Given
    const args = ['4101', '4102', '-ri'];

    // When / Then
    expect(typeof parseInvocation).toBe('function');
    if (typeof parseInvocation !== 'function') {
      return;
    }
    expect(parseInvocation(args)).toEqual({
      mode: 'issue-numbers',
      issue_numbers: [4101, 4102],
      recommend_issues: true,
    });
  });
});
