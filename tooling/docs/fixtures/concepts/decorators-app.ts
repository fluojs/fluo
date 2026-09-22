import { Inject, Module } from '@fluojs/core';
import { Controller, FromBody, Post, RequestDto } from '@fluojs/http';
import { IsString, MinLength } from '@fluojs/validation';

class CreateMessage {
  @FromBody()
  @IsString()
  @MinLength(1)
  text = '';
}

class MessagesService {
  receive(text: string) {
    return { message: `received: ${text}` };
  }
}

@Inject(MessagesService)
@Controller('/messages')
class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post()
  @RequestDto(CreateMessage)
  create(input: CreateMessage) {
    return this.messages.receive(input.text);
  }
}

@Module({
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class AppModule {}
