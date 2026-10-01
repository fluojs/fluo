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

export const GenericReader = createGeneric(() => ({ tag: 'ready' as const, count: 1 }));
