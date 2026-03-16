import type { HandlerDescriptor } from '@konekti/http';

export class OpenApiHandlerRegistry {
  private descriptors: HandlerDescriptor[] = [];

  setDescriptors(descriptors: readonly HandlerDescriptor[]): void {
    this.descriptors = [...descriptors];
  }

  getDescriptors(): HandlerDescriptor[] {
    return [...this.descriptors];
  }
}
