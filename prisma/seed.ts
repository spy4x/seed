import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // const john = await prisma.user.upsert({
  //   where: {
  //     userName: 'JohnDoe',
  //   },
  //   update: {},
  //   create: {
  //     id: '1234567891234567891234567898',
  //     firstName: 'John',
  //     lastName: 'Doe',
  //     bio: 'BEIOPAJE AE',
  //     phone: '+212747738322',
  //     userName: 'JohnDoe',
  //   },
  // });
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
