import { ensureMetadataSymbol, Inject, Module, Scope } from '@fluojs/core';
import { Controller, FromBody, Get, type GuardContext, Post, type RequestContext, RequestDto, UseGuards } from '@fluojs/http';
import { IsDefined, IsInt, IsString, Min, MinLength } from '@fluojs/validation';
import { bodyFields, StageService, type StageShape, serializedStage, serviceResult } from './stage-workloads.js';
import { queryValue } from './workloads.js';

ensureMetadataSymbol();

function query(context: RequestContext, name: string) { return queryValue(context.request.query[name]); }

@Controller('/stage')
class MinimalController {
  @Get('')
  read() { return { ok: true }; }
}

@Controller('/stage/items')
class RoutingController {
  @Get('/:itemId')
  read(_input: undefined, context: RequestContext) {
    return { itemId: context.request.params.itemId, value: query(context, 'value') };
  }
}

@Inject(StageService, StageService)
@Controller('/stage')
class SingletonController {
  constructor(private readonly first: StageService, private readonly second: StageService) {}
  @Get('')
  read(_input: undefined, context: RequestContext) {
    return serviceResult(this.first, this.second, query(context, 'value'), query(context, 'probe'));
  }
}

@Scope('request')
class RequestService extends StageService {}

@Scope('request')
@Inject(RequestService, RequestService)
@Controller('/stage')
class RequestController {
  constructor(private readonly first: RequestService, private readonly second: RequestService) {}
  @Get('')
  read(_input: undefined, context: RequestContext) {
    return serviceResult(this.first, this.second, query(context, 'value'), query(context, 'probe'));
  }
}

@Controller('/stage')
class BodyController {
  @Post('')
  read(_input: undefined, context: RequestContext) { return bodyFields(context.request.body); }
}

class StageGuard {
  canActivate(context: GuardContext) { return query(context.requestContext, 'token') === 'allow'; }
}
@Controller('/stage')
class GuardController {
  @UseGuards(StageGuard)
  @Get('')
  read(_input: undefined, context: RequestContext) { return { value: query(context, 'value'), allowed: true }; }
}

class ValidatedStageDto {
  @FromBody()
  @IsDefined()
  @IsString()
  @MinLength(1)
  name = '';

  @FromBody()
  @IsDefined()
  @IsInt()
  @Min(1)
  quantity = 0;
}
@Controller('/stage')
class ValidationController {
  @RequestDto(ValidatedStageDto)
  @Post('')
  read(input: ValidatedStageDto) { return { name: input.name, quantity: input.quantity, bound: input instanceof ValidatedStageDto }; }
}

@Controller('/stage')
class SerializationController {
  @Get('')
  read(_input: undefined, context: RequestContext) { return serializedStage(query(context, 'value')); }
}

@Module({ controllers: [MinimalController] })
class MinimalModule {}
@Module({ controllers: [RoutingController] })
class RoutingModule {}
@Module({ controllers: [SingletonController], providers: [StageService] })
class SingletonModule {}
@Module({ controllers: [RequestController], providers: [RequestService] })
class RequestModule {}
@Module({ controllers: [BodyController] })
class BodyModule {}
@Module({ controllers: [GuardController], providers: [StageGuard] })
class GuardModule {}
@Module({ controllers: [ValidationController] })
class ValidationModule {}
@Module({ controllers: [SerializationController] })
class SerializationModule {}

export function resolveStageModule(shape: StageShape) {
  switch (shape) {
    case 'stage-minimal': return MinimalModule;
    case 'stage-routing-params': return RoutingModule;
    case 'stage-singleton-di': return SingletonModule;
    case 'stage-request-di': return RequestModule;
    case 'stage-body': return BodyModule;
    case 'stage-guards': return GuardModule;
    case 'stage-dto-validation': return ValidationModule;
    case 'stage-serialization': return SerializationModule;
  }
}
