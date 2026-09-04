import type { Container } from '@fluojs/di';

type AssertNever<Value extends never> = Value;
type ConstructorArguments = ConstructorParameters<typeof Container>;

export type ContainerConstructorArgumentsAreUnassignable = AssertNever<ConstructorArguments[number]>;
