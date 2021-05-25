import { Injectable } from '@nestjs/common';
import { ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../services';

@Injectable()
export abstract class CommandHandler<T> implements ICommandHandler<T> {
  protected constructor(protected readonly prisma: PrismaService) {}
  abstract execute(command: T): Promise<unknown>;
}
