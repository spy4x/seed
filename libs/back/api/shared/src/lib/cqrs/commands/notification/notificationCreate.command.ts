import { NotificationType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Length } from 'class-validator';
import { FIREBASE_AUTH_UID_LENGTH } from '@seed/shared/constants';

export class NotificationCreateCommand {
  @ApiProperty()
  @IsString()
  @Length(FIREBASE_AUTH_UID_LENGTH, FIREBASE_AUTH_UID_LENGTH, {
    message: `Field 'userId' should be ${FIREBASE_AUTH_UID_LENGTH} characters long.`,
  })
  userId: string;

  @ApiProperty({ enum: NotificationType, enumName: 'NotificationType' })
  @IsEnum(NotificationType, {
    message: `Field 'type' should be one of values: [${Object.keys(NotificationType).join(', ')}]`,
  })
  type: NotificationType;

  constructor(userId: string, type: NotificationType) {
    this.userId = userId;
    this.type = type;
  }
}
