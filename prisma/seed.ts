import { PrismaClient, Prisma } from '@prisma/client';
import * as faker from 'faker';

const prisma = new PrismaClient();

async function main() {
  await createFakeUsers();
}

async function createFakeUsers(): Promise<void> {
  const start = new Date();
  const fakeUsersAmount = 100;
  console.log(`Creating ${fakeUsersAmount} fake users...`);
  const fakeUsers = Array.from({ length: fakeUsersAmount }).map(() => {
    const user: Prisma.UserCreateInput = {
      id: faker.random.alphaNumeric(28),
      userName: faker.internet.userName(),
      firstName: faker.name.firstName(),
      lastName: faker.name.lastName(),
      photoURL: faker.internet.avatar(),
      isPushNotificationsEnabled: faker.datatype.boolean(),
    };
    return user;
  });
  await prisma.user.createMany({ data: fakeUsers });
  console.log(`Done in ${new Date().getTime() - start.getTime()}ms`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
