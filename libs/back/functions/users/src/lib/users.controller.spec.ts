import { Test } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('BackFunctionsUsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [UsersService],
      controllers: [UsersController],
    }).compile();

    controller = module.get(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeTruthy();
  });
});
