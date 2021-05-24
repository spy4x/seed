import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { FindUsersQuery, SharedModule } from '@seed/back/api/shared';
import { UsersController } from './users.controller';

describe('UsersController', () => {
  let controller: UsersController;

  const executeMock = jest.fn();
  const queryBusMock = jest.fn().mockImplementation(() => ({
    execute: executeMock,
  }));
  const commandBusMock = jest.fn();
  const currentUserId = '123';

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [SharedModule],
      controllers: [UsersController],
      providers: [
        { provide: QueryBus, useClass: queryBusMock },
        { provide: CommandBus, useClass: commandBusMock },
      ],
    }).compile();

    controller = module.get(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeTruthy();
  });
  describe('get', () => {
    it('should be called with provided parameters', async () => {
      const query = new FindUsersQuery(1, 20);
      await controller.find(query, currentUserId);
    });
  });
});
