import { Inject, Module } from '@fluojs/core';
import {
  CommandBusLifecycleService,
  CommandHandler,
  CqrsEventBusService,
  CqrsModule,
  EventHandler,
  QueryHandler,
  Saga,
  type CqrsDispatchContext,
  type ICommand,
  type ICommandHandler,
  type IEvent,
  type IEventHandler,
  type IQuery,
  type IQueryHandler,
  type ISaga,
} from '@fluojs/cqrs';
import { OnEvent } from '@fluojs/event-bus';

/**
 * Complete canonical CQRS application from the CQRS guide
 * (apps/docs/content/docs/packages/cqrs.mdx): a command with its handler, a
 * typed query, an event with an @EventHandler projection, a @Saga that
 * dispatches a follow-up command, and a delegated @OnEvent observer. Guide
 * fixtures compile this app with the real buses and assert the documented
 * pipeline order.
 */

export interface UserView {
  id: string;
  name: string;
}

export class CreateUserCommand implements ICommand {
  constructor(public readonly name: string) {}
}

export class SendWelcomeEmailCommand implements ICommand {
  constructor(public readonly userId: string) {}
}

export class UnknownCommand implements ICommand {}

export class GetUserQuery implements IQuery<UserView | undefined> {
  // Optional marker property carrying the result type: it satisfies the
  // IQuery structural contract and drives the bus's typed result inference.
  readonly __queryResultType__?: UserView | undefined;

  constructor(public readonly userId: string) {}
}

export class OrderPlacedEvent implements IEvent {
  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
  ) {}
}

/**
 * Application-owned observation seam. Every pipeline stage appends exactly
 * one entry in execution order; the publish test asserts that order.
 */
export class CqrsTimeline {
  readonly entries: string[] = [];
  readonly projectionCopies: OrderPlacedEvent[] = [];
  readonly delegatedPayloads: OrderPlacedEvent[] = [];
  readonly createdUsers: string[] = [];
}

@Inject(CqrsTimeline)
@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand, string> {
  constructor(private readonly timeline: CqrsTimeline) {}

  async execute(command: CreateUserCommand): Promise<string> {
    this.timeline.entries.push('command:create-user');
    this.timeline.createdUsers.push(command.name);
    return `user-${command.name}`;
  }
}

@CommandHandler(CreateUserCommand)
export class DuplicateCreateUserHandler implements ICommandHandler<CreateUserCommand, string> {
  async execute(command: CreateUserCommand): Promise<string> {
    return `duplicate-${command.name}`;
  }
}

@Inject(CqrsTimeline)
@CommandHandler(SendWelcomeEmailCommand)
export class SendWelcomeEmailHandler implements ICommandHandler<SendWelcomeEmailCommand, void> {
  constructor(private readonly timeline: CqrsTimeline) {}

  async execute(command: SendWelcomeEmailCommand): Promise<void> {
    this.timeline.entries.push(`command:welcome-email:${command.userId}`);
  }
}

@QueryHandler(GetUserQuery)
export class GetUserHandler implements IQueryHandler<GetUserQuery, UserView | undefined> {
  async execute(query: GetUserQuery): Promise<UserView | undefined> {
    if (query.userId === 'missing') {
      return undefined;
    }

    return { id: query.userId, name: 'fluo' };
  }
}

@Inject(CqrsTimeline)
@EventHandler(OrderPlacedEvent)
export class OrderSummaryProjectionHandler implements IEventHandler<OrderPlacedEvent> {
  constructor(private readonly timeline: CqrsTimeline) {}

  async handle(event: OrderPlacedEvent): Promise<void> {
    this.timeline.entries.push(`event-handler:${event.orderId}`);
    this.timeline.projectionCopies.push(event);
  }
}

@Inject(CommandBusLifecycleService, CqrsTimeline)
@Saga(OrderPlacedEvent)
export class OrderOnboardingSaga implements ISaga<OrderPlacedEvent> {
  constructor(
    private readonly commandBus: CommandBusLifecycleService,
    private readonly timeline: CqrsTimeline,
  ) {}

  async handle(event: OrderPlacedEvent, context?: CqrsDispatchContext): Promise<void> {
    this.timeline.entries.push(`saga:${event.orderId}`);
    await this.commandBus.execute(new SendWelcomeEmailCommand(event.orderId), context);
  }
}

@Inject(CqrsTimeline)
export class DelegatedObserver {
  constructor(private readonly timeline: CqrsTimeline) {}

  @OnEvent(OrderPlacedEvent)
  async observe(event: OrderPlacedEvent): Promise<void> {
    this.timeline.entries.push(`delegated:${event.orderId}`);
    this.timeline.delegatedPayloads.push(event);
  }
}

@Inject(CqrsEventBusService)
export class OrderService {
  constructor(private readonly events: CqrsEventBusService) {}

  async placeOrder(orderId: string, customerId: string): Promise<void> {
    await this.events.publish(new OrderPlacedEvent(orderId, customerId));
  }
}

export function createCqrsGuideApp() {
  @Module({
    imports: [CqrsModule.forRoot()],
    providers: [
      CqrsTimeline,
      CreateUserHandler,
      SendWelcomeEmailHandler,
      GetUserHandler,
      OrderSummaryProjectionHandler,
      OrderOnboardingSaga,
      DelegatedObserver,
      OrderService,
    ],
  })
  class CqrsGuideAppModule {}

  return { AppModule: CqrsGuideAppModule, CqrsTimeline, DelegatedObserver };
}

export function createDuplicateCommandHandlerApp() {
  @Module({
    imports: [CqrsModule.forRoot()],
    providers: [CqrsTimeline, CreateUserHandler, DuplicateCreateUserHandler],
  })
  class DuplicateCqrsGuideAppModule {}

  return { AppModule: DuplicateCqrsGuideAppModule };
}
