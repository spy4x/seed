-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN', 'MODERATOR');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('WELCOME');

-- CreateTable
CREATE TABLE "users" (
    "id" VARCHAR(28) NOT NULL,
    "userName" VARCHAR(25) NOT NULL,
    "firstName" VARCHAR(50) NOT NULL,
    "lastName" VARCHAR(50) NOT NULL,
    "role" "Role" NOT NULL DEFAULT E'USER',
    "photoURL" VARCHAR(300),
    "isPushNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastTimeSignedIn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "userDevices" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "userId" VARCHAR(28) NOT NULL,
    "fcmToken" VARCHAR(256) NOT NULL,
    "deviceId" VARCHAR(50),
    "deviceName" VARCHAR(50),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "type" "NotificationType" NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "userId" VARCHAR(28) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users.userName_unique" ON "users"("userName");

-- CreateIndex
CREATE UNIQUE INDEX "userDevices.fcmToken_userId_unique" ON "userDevices"("fcmToken", "userId");

-- AddForeignKey
ALTER TABLE "userDevices" ADD FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
