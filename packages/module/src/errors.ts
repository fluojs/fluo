import { KonektiError } from '@konekti/core';

export class ModuleGraphError extends KonektiError {
  constructor(message: string) {
    super(message, { code: 'MODULE_GRAPH_ERROR' });
  }
}

export class ModuleVisibilityError extends KonektiError {
  constructor(message: string) {
    super(message, { code: 'MODULE_VISIBILITY_ERROR' });
  }
}
