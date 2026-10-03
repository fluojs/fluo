import {
  BadRequestException, Body, Controller, type ExecutionContext, Get, Inject, Injectable, Module, Param,type PipeTransform,
  Post, Query, Res, Scope, UseGuards, 
} from '@nestjs/common';
import { bodyFields, materializeStageDto, StageDto, StageService, type StageShape, serializedStage, serviceResult } from './stage-workloads';

type CompletionResponse = { once(event: 'finish', listener: () => void): unknown };
type StageResponse = CompletionResponse | { readonly raw: CompletionResponse };

/** Imperative decorators work in both the standard and Nest legacy compilations. */
export function resolveNestStageModule(shape: StageShape) {
  class NestStageService extends StageService {}
  class StageGuard {
    canActivate(context: ExecutionContext) {
      const request = context.switchToHttp().getRequest<{ readonly query: { readonly token?: string } }>();
      return request.query.token === 'allow';
    }
  }
  class DtoPipe implements PipeTransform<unknown, StageDto> {
    transform(body: unknown) {
      const dto = materializeStageDto(body);
      if (!dto) throw new BadRequestException('Invalid stage DTO');
      return dto;
    }
  }
  class MinimalController {
    read() { return { ok: true }; }
  }
  class RoutingController {
    read(itemId: string, value = '') { return { itemId, value }; }
  }
  class ServiceController {
    constructor(private readonly first: StageService, private readonly second: StageService) {}
    read(value = '', probe = '', response: StageResponse) {
      if (shape === 'stage-request-di') {
        const raw = 'raw' in response ? response.raw : response;
        raw.once('finish', () => this.first.onDestroy());
      }
      return serviceResult(this.first, this.second, value, probe);
    }
  }
  class BodyController {
    read(body: unknown) { return bodyFields(body); }
  }
  class GuardController {
    read(value = '') { return { value, allowed: true }; }
  }
  class ValidationController {
    read(dto: StageDto) { return { name: dto.name, quantity: dto.quantity, bound: dto instanceof StageDto }; }
  }
  class SerializationController {
    read(value = '') { return serializedStage(value); }
  }
  const descriptor = (controller: { readonly prototype: object }) => Object.getOwnPropertyDescriptor(controller.prototype, 'read');
  let controller: typeof MinimalController | typeof RoutingController | typeof ServiceController | typeof BodyController | typeof GuardController | typeof ValidationController | typeof SerializationController;
  const providers: (typeof NestStageService | typeof StageGuard)[] = [];
  switch (shape) {
    case 'stage-minimal':
      controller = MinimalController;
      break;
    case 'stage-routing-params':
      controller = RoutingController;
      Param('itemId')(controller.prototype, 'read', 0);
      Query('value')(controller.prototype, 'read', 1);
      break;
    case 'stage-singleton-di':
    case 'stage-request-di':
      controller = ServiceController;
      Injectable({ scope: shape === 'stage-request-di' ? Scope.REQUEST : Scope.DEFAULT })(NestStageService);
      Inject(NestStageService)(controller, undefined, 0);
      Inject(NestStageService)(controller, undefined, 1);
      Query('value')(controller.prototype, 'read', 0);
      Query('probe')(controller.prototype, 'read', 1);
      Res({ passthrough: true })(controller.prototype, 'read', 2);
      providers.push(NestStageService);
      break;
    case 'stage-body':
      controller = BodyController;
      Body()(controller.prototype, 'read', 0);
      break;
    case 'stage-guards':
      controller = GuardController;
      Query('value')(controller.prototype, 'read', 0);
      UseGuards(StageGuard)(controller);
      providers.push(StageGuard);
      break;
    case 'stage-dto-validation':
      controller = ValidationController;
      Body(new DtoPipe())(controller.prototype, 'read', 0);
      break;
    case 'stage-serialization':
      controller = SerializationController;
      Query('value')(controller.prototype, 'read', 0);
      break;
  }
  const path = shape === 'stage-routing-params' ? '/stage/items' : '/stage';
  Controller({ path, scope: shape === 'stage-request-di' ? Scope.REQUEST : Scope.DEFAULT })(controller);
  const route = shape === 'stage-body' || shape === 'stage-dto-validation' ? Post('') : Get(shape === 'stage-routing-params' ? ':itemId' : '');
  const method = descriptor(controller);
  if (!method) throw new Error('Stage controller has no handler descriptor');
  route(controller.prototype, 'read', method);
  class StageModule {}
  Module({ controllers: [controller], providers })(StageModule);
  return StageModule;
}
