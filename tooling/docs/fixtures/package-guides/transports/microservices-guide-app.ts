/**
 * Complete example from the `@fluojs/microservices` package guide
 * (`apps/docs/content/docs/packages/microservices.mdx`).
 *
 * A TCP microservice:
 * - `MathHandlers` registers one request-response route (`@MessagePattern`)
 *   and one fire-and-forget event route (`@EventPattern` with a `RegExp`).
 * - The class injects `AuditLog` through normal constructor DI; request- and
 *   event-scoped handlers would additionally get a fresh container per dispatch.
 * - `MicroservicesModule.forRoot({ transport })` wires the lifecycle service
 *   and the programmatic `MICROSERVICE` facade globally (default `global: true`).
 * - `TcpMicroserviceTransport.create({ port: 0 })` lets the OS assign an
 *   ephemeral listener; the same transport routes outbound `send()`/`emit()`
 *   loopback frames to that listener while it is listening.
 *
 * Bootstrap for providers is `await FluoFactory.createMicroservice(AppModule)`
 * followed by `await microservice.listen()`.
 */
import { Inject, Module } from '@fluojs/core';
import { EventPattern, MessagePattern, MicroservicesModule } from '@fluojs/microservices';
import { TcpMicroserviceTransport } from '@fluojs/microservices/tcp';

export class AuditLog {
  readonly events: string[] = [];
}

@Inject(AuditLog)
export class MathHandlers {
  constructor(private readonly audit: AuditLog) {}

  @MessagePattern('math.sum')
  sum(input: { a: number; b: number }): number {
    this.audit.events.push('math.sum');
    return input.a + input.b;
  }

  @EventPattern(/^audit\./)
  onAuditEvent(input: { message: string }): void {
    this.audit.events.push(input.message);
  }
}

@Module({
  imports: [MicroservicesModule.forRoot({ transport: TcpMicroserviceTransport.create({ port: 0 }) })],
  providers: [AuditLog, MathHandlers],
})
export class AppModule {}
