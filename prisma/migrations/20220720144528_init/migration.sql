-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN', 'MODERATOR');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('WELCOME', 'TEST');

-- CreateTable
CREATE TABLE "users" (
    "id" VARCHAR(28) NOT NULL,
    "userName" VARCHAR(25) NOT NULL,
    "firstName" VARCHAR(50) NOT NULL,
    "lastName" VARCHAR(50) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "photoURL" VARCHAR(300),
    "isPushNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastTimeSignedIn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
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

    CONSTRAINT "userDevices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "type" "NotificationType" NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "userId" VARCHAR(28) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_userName_key" ON "users"("userName");

-- CreateIndex
CREATE UNIQUE INDEX "userDevices_fcmToken_userId_key" ON "userDevices"("fcmToken", "userId");

-- AddForeignKey
ALTER TABLE "userDevices" ADD CONSTRAINT "userDevices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
