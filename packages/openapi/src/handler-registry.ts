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

const registry = new OpenApiHandlerRegistry();

export function setOpenApiHandlerDescriptors(descriptors: readonly HandlerDescriptor[]): void {
  registry.setDescriptors(descriptors);
}

export function getOpenApiHandlerDescriptors(): HandlerDescriptor[] {
  return registry.getDescriptors();
}
