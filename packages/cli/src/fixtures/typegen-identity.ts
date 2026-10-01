/**
 * Create separate runtime constructors from the same lexical declarations for source association tests.
 *
 * @returns One invocation's input and router constructors.
 */
export function createIdentityFixture() {
  class Input {
    query = '';
  }
  class Router {
    show(input: Input) {
      return { query: input.query };
    }
  }
  return { Input, Router };
}

/** Class-expression fixture whose runtime identity must retain its source declaration. */
export const ExpressionInput = class {
  query = '';
};

function createGeneric<Result>(read: () => Result) {
  return class {
    get() {
      return read();
    }
  };
}

/** Concrete generic-factory result used to test inferred handler return types. */
export const GenericReader = createGeneric(() => ({ tag: 'ready' as const, count: 1 }));
