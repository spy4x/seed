import { Injectable } from '@nestjs/common';
import { ICommandHandler, ICommand } from '@nestjs/cqrs';

@Injectable()
export abstract class BaseCommandHandler<T extends ICommand, R> implements ICommandHandler<T, R> {
  abstract execute(command: T): Promise<R>;
}
