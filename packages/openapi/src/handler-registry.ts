import type { HandlerDescriptor } from '@fluojs/http';

import { cloneSnapshotValue } from './snapshot.js';

/**
 * Mutable registry used to snapshot handler descriptors before document generation.
 */
export class OpenApiHandlerRegistry {
  private descriptors: HandlerDescriptor[] = [];

  /**
   * Replace the current handler-descriptor snapshot.
   *
   * @param descriptors Handler descriptors to retain for later document generation.
   */
  setDescriptors(descriptors: readonly HandlerDescriptor[]): void {
    this.descriptors = cloneSnapshotValue(descriptors) as HandlerDescriptor[];
  }

  /**
   * Read the registered handler-descriptor snapshot.
   *
   * @returns A defensive copy of the current handler descriptors.
   */
  getDescriptors(): HandlerDescriptor[] {
    return cloneSnapshotValue(this.descriptors);
  }
}
