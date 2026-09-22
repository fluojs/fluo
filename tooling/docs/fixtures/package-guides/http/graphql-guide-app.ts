import { Inject, Module, Scope } from '@fluojs/core';
import { Arg, GraphqlModule, Mutation, Query, Resolver } from '@fluojs/graphql';
import { IsString, MinLength } from '@fluojs/validation';

/**
 * Runnable application for the GraphQL package guide
 * (apps/docs/content/docs/packages/graphql.mdx).
 *
 * Composes @fluojs/graphql with @fluojs/validation (DTO rules become
 * BAD_USER_INPUT issues) and the DI scope system (a request-scoped store and a
 * request-scoped resolver sharing one operation container).
 */

class EchoInput {
  @Arg('value')
  @IsString()
  @MinLength(2)
  value = '';
}

class SetMessageInput {
  @Arg('message')
  @IsString()
  message = '';
}

@Scope('request')
export class MessageStore {
  message = 'initial';
}

@Inject(MessageStore)
@Scope('request')
@Resolver()
export class MessagesResolver {
  constructor(private readonly store: MessageStore) {}

  @Query({ input: EchoInput })
  echo(input: EchoInput): string {
    return `echo: ${input.value}`;
  }

  @Mutation({ input: SetMessageInput })
  setMessage(input: SetMessageInput): string {
    this.store.message = input.message;
    return this.store.message;
  }

  @Query({ fieldName: 'currentMessage' })
  currentMessage(): string {
    return this.store.message;
  }
}

@Module({
  imports: [GraphqlModule.forRoot()],
  providers: [MessageStore, MessagesResolver],
})
export class GraphqlAppModule {}
