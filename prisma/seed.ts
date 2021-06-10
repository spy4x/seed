import { PrismaClient, Prisma, NotificationType } from '@prisma/client';
import * as faker from 'faker';
import { getUUID } from '../libs/shared/helpers/src';

const prisma = new PrismaClient();

async function main() {
  const users = await createFakeUsers();
  await createFakeUserDevices(users);
  await createFakeNotifications(users);
}

async function createFakeUsers(): Promise<Prisma.UserCreateManyInput[]> {
  const start = new Date();
  const fakeUsersAmount = 100;
  console.log(`Creating ${fakeUsersAmount} fake users...`);
  const users = Array.from({ length: fakeUsersAmount }).map(() => {
    const user: Prisma.UserCreateManyInput = {
      id: faker.random.alphaNumeric(28),
      userName: faker.internet.userName(),
      firstName: faker.name.firstName(),
      lastName: faker.name.lastName(),
      photoURL: faker.internet.avatar(),
      isPushNotificationsEnabled: faker.datatype.boolean(),
    };
    return user;
  });
  await prisma.user.createMany({ data: users });
  console.log(`Done in ${new Date().getTime() - start.getTime()}ms`);
  return users;
}

async function createFakeUserDevices(users: Prisma.UserCreateInput[]): Promise<Prisma.UserDeviceCreateManyInput[]> {
  const start = new Date();
  console.log(`Creating fake user devices...`);
  const userDevices: Prisma.UserDeviceCreateManyInput[] = [];
  users.forEach(user => {
    const random = Math.random();
    const amount = random > 0.8 ? 3 : random > 0.5 ? 2 : random > 0.3 ? 1 : 0;
    Array.from({ length: amount }).forEach(() =>
      userDevices.push({
        id: getUUID(),
        fcmToken: getUUID(),
        deviceId: getUUID(),
        deviceName: faker.internet.userName(),
        userId: user.id,
      }),
    );
  });
  console.log(`User devices to create: ${userDevices.length}`);
  await prisma.userDevice.createMany({ data: userDevices });
  console.log(`Done in ${new Date().getTime() - start.getTime()}ms`);
  return userDevices;
}

async function createFakeNotifications(users: Prisma.UserCreateInput[]): Promise<Prisma.NotificationCreateManyInput[]> {
  const start = new Date();
  console.log(`Creating fake notifications...`);
  const notifications: Prisma.NotificationCreateManyInput[] = [];
  users.forEach(user => {
    const random = Math.random();
    const amount = random > 0.8 ? 3 : random > 0.5 ? 2 : random > 0.3 ? 1 : 0;
    Array.from({ length: amount }).forEach(() =>
      notifications.push({
        id: getUUID(),
        type: NotificationType.WELCOME,
        userId: user.id,
      }),
    );
  });
  console.log(`Notifications to create: ${notifications.length}`);
  await prisma.notification.createMany({ data: notifications });
  console.log(`Done in ${new Date().getTime() - start.getTime()}ms`);
  return notifications;
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
