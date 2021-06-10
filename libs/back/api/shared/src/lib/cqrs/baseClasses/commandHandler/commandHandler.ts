import { Injectable } from '@nestjs/common';
import { ICommandHandler } from '@nestjs/cqrs';

@Injectable()
export abstract class BaseCommandHandler<T> implements ICommandHandler<T> {
  abstract execute(command: T): Promise<unknown>;
}
