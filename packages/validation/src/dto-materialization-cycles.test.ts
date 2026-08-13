import { describe, expect, it } from 'vitest';

import { MinLength, ValidateNested } from './decorators.js';
import { DefaultValidator } from './validation.js';

describe('DTO materialization cycle guards', () => {
  it('keeps a self-referential raw root guarded while validating its DTO', async () => {
    // Given
    let constructorRuns = 0;

    class NodeDto {
      @MinLength(1)
      name = '';

      @ValidateNested(() => NodeDto)
      child?: NodeDto;

      constructor() {
        constructorRuns += 1;
      }
    }

    const payload: { child?: unknown; name: string } = { name: 'root' };
    payload.child = payload;

    // When / Then
    await expect(
      new DefaultValidator().materialize(payload, NodeDto),
    ).rejects.toMatchObject({
      issues: [{ code: 'INVALID_NESTED', field: 'child', message: 'child contains invalid nested data.' }],
    });
    expect(constructorRuns).toBe(1);
  });

  it('rejects a raw root self-cycle at its first different-constructor re-entry', async () => {
    // Given
    let childConstructorRuns = 0;

    class RootDto {
      @ValidateNested(() => ChildDto)
      child?: ChildDto;
    }

    class ChildDto {
      @MinLength(1)
      name = '';

      constructor() {
        childConstructorRuns += 1;
      }
    }

    const payload: { child?: unknown; name: string } = { name: 'root' };
    payload.child = payload;

    // When / Then
    await expect(
      new DefaultValidator().materialize(payload, RootDto),
    ).rejects.toMatchObject({
      issues: [{ code: 'INVALID_NESTED', field: 'child', message: 'child contains invalid nested data.' }],
    });
    expect(childConstructorRuns).toBe(0);
  });

  it('rejects a mutual raw cycle at its different-constructor re-entry', async () => {
    // Given
    let alternateParentConstructorRuns = 0;

    class ParentDto {
      @ValidateNested(() => ChildDto)
      child?: ChildDto;
    }

    class ChildDto {
      @ValidateNested(() => AlternateParentDto)
      parent?: AlternateParentDto;
    }

    class AlternateParentDto {
      @MinLength(1)
      name = '';

      constructor() {
        alternateParentConstructorRuns += 1;
      }
    }

    type ParentPayload = { child?: unknown; name: string };

    const parent: ParentPayload = { name: 'parent' };
    parent.child = { name: 'child', parent };

    // When / Then
    await expect(
      new DefaultValidator().materialize(parent, ParentDto),
    ).rejects.toMatchObject({
      issues: [{
        code: 'INVALID_NESTED',
        field: 'child.parent',
        message: 'child.parent contains invalid nested data.',
      }],
    });
    expect(alternateParentConstructorRuns).toBe(0);
  });

  it('keeps raw-to-existing-DTO cycles guarded across materialization and validation', async () => {
    // Given
    let childConstructorRuns = 0;
    let parentConstructorRuns = 0;

    class ParentDto {
      @MinLength(1)
      name = '';

      @ValidateNested(() => ChildDto)
      child?: ChildDto;

      constructor() {
        parentConstructorRuns += 1;
      }
    }

    class ChildDto {
      @MinLength(1)
      name = '';

      @ValidateNested(() => ParentDto)
      parent?: ParentDto;

      constructor() {
        childConstructorRuns += 1;
      }
    }

    type ParentPayload = { child?: ChildDto; name: string };

    const parent: ParentPayload = { name: 'parent' };
    const child = Object.assign(new ChildDto(), { name: 'child', parent });
    parent.child = child;

    // When / Then
    await expect(
      new DefaultValidator().materialize(parent, ParentDto),
    ).rejects.toMatchObject({
      issues: [{
        code: 'INVALID_NESTED',
        field: 'child.parent',
        message: 'child.parent contains invalid nested data.',
      }],
    });
    expect(parentConstructorRuns).toBe(1);
    expect(childConstructorRuns).toBe(1);
  });

  it('keeps raw-to-existing-DTO collection cycles guarded during materialization', async () => {
    // Given
    class ParentDto {
      @ValidateNested(() => ChildDto)
      children: ChildDto[] = [];
    }

    class ChildDto {
      @ValidateNested(() => ParentDto)
      parent?: ParentDto;
    }

    type ParentPayload = { children: ChildDto[] };

    const parent: ParentPayload = { children: [] };
    const child = Object.assign(new ChildDto(), { parent });
    parent.children.push(child);

    // When / Then
    await expect(
      new DefaultValidator().materialize(parent, ParentDto),
    ).rejects.toMatchObject({
      issues: [{
        code: 'INVALID_NESTED',
        field: 'children[0].parent',
        message: 'children[0].parent contains invalid nested data.',
      }],
    });
  });

  it('continues to allow one raw object to be shared by sibling fields', async () => {
    // Given
    class ChildDto {
      @MinLength(1)
      name = '';
    }

    class ParentDto {
      @ValidateNested(() => ChildDto)
      left?: ChildDto;

      @ValidateNested(() => ChildDto)
      right?: ChildDto;
    }

    const shared = { name: 'shared' };

    // When
    const result = await new DefaultValidator().materialize<ParentDto>({ left: shared, right: shared }, ParentDto);

    // Then
    expect(result.left).toBeInstanceOf(ChildDto);
    expect(result.right).toBeInstanceOf(ChildDto);
    expect(result.left).toBe(result.right);
  });

  it('preserves constructor-specific identity for non-cyclic shared raw references', async () => {
    // Given
    class LeftChildDto {
      @MinLength(1)
      name = '';
    }

    class RightChildDto {
      @MinLength(1)
      name = '';
    }

    class ParentDto {
      @ValidateNested(() => LeftChildDto)
      left?: LeftChildDto;

      @ValidateNested(() => RightChildDto)
      right?: RightChildDto;
    }

    const shared = { name: 'shared' };

    // When
    const result = await new DefaultValidator().materialize<ParentDto>({ left: shared, right: shared }, ParentDto);

    // Then
    expect(result.left).toBeInstanceOf(LeftChildDto);
    expect(result.right).toBeInstanceOf(RightChildDto);
    expect(result.left).not.toBe(result.right);
  });
});
