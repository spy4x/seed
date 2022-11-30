import { Test } from '@nestjs/testing';
import { UsersFindQuery, SharedModule, QueryBusExt, CommandBusExt } from '@seed/back/api/shared';
import { UsersController } from './users.controller';

describe(UsersController.name, () => {
  let controller: UsersController;

  const executeMock = jest.fn();
  const queryBusMock = jest.fn().mockImplementation(() => ({
    execute: executeMock,
  }));
  const commandBusMock = jest.fn();

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [SharedModule],
      controllers: [UsersController],
      providers: [
        { provide: QueryBusExt, useClass: queryBusMock },
        { provide: CommandBusExt, useClass: commandBusMock },
      ],
    }).compile();

    controller = module.get(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeTruthy();
  });
  describe(UsersController.prototype.get.name, () => {
    it('should be called with provided parameters', async () => {
      const query = new UsersFindQuery(1, 20);
      await controller.find(query);
    });
  });
});
