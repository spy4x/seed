import { Test } from '@nestjs/testing';
import { PrismaService, UserUpdateCommand } from '@seed/back/api/shared';
import { UserUpdateCommandHandler } from './userUpdate.commandHandler';
import { mockUsers } from '@seed/shared/mock-data';
import { User, UserRole } from '@prisma/client';

describe('UserUpdateCommandHandler', () => {
  const [user] = mockUsers;
  const updateMock = jest.fn();
  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    user: {
      update: updateMock,
    },
  }));

  const command = new UserUpdateCommand(
    user.id,
    user.userName,
    user.firstName,
    user.lastName,
    user.photoURL as string,
    true,
  );
  let userUpdateCommandHandler: UserUpdateCommandHandler;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UserUpdateCommandHandler, { provide: PrismaService, useClass: prismaServiceMock }],
    }).compile();

    userUpdateCommandHandler = moduleRef.get(UserUpdateCommandHandler);
  });

  describe('execute', () => {
    it('should call prisma.user.update with expected arguments and return updatedUser', async () => {
      const { id, firstName, lastName, userName, photoURL, isPushNotificationsEnabled } = command;
      const now = new Date();
      const updatedUser: User = {
        id,
        userName: userName || user.userName,
        firstName: firstName || user.firstName,
        lastName: lastName || user.lastName,
        photoURL: photoURL || user.photoURL,
        isPushNotificationsEnabled: isPushNotificationsEnabled || user.isPushNotificationsEnabled,
        role: UserRole.USER,
        createdAt: now,
        updatedAt: now,
        lastTimeSignedIn: now,
      };
      updateMock.mockReturnValueOnce(updatedUser);
      expect(await userUpdateCommandHandler.execute(command)).toEqual(updatedUser);
      expect(updateMock).toBeCalledWith({
        where: {
          id,
        },
        data: {
          userName,
          firstName,
          lastName,
          photoURL,
          isPushNotificationsEnabled,
        },
      });
    });
  });
});
