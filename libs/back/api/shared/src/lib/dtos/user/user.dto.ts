import { ApiProperty } from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';

export class UserDTO implements User {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userName: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty({ required: false, type: String })
  photoURL: string | null;

  @ApiProperty()
  isPushNotificationsEnabled: boolean;

  @ApiProperty({ enum: UserRole, enumName: 'UserRole' })
  role: UserRole;

  @ApiProperty()
  lastTimeSignedIn: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  constructor(
    id: string,
    userName: string,
    firstName: string,
    lastName: string,
    photoURL: string | null,
    isPushNotificationsEnabled: boolean,
    role: UserRole,
    lastTimeSignedIn: Date,
    createdAt: Date,
    updatedAt: Date,
  ) {
    this.id = id;
    this.userName = userName;
    this.firstName = firstName;
    this.lastName = lastName;
    this.photoURL = photoURL;
    this.isPushNotificationsEnabled = isPushNotificationsEnabled;
    this.role = role;
    this.lastTimeSignedIn = lastTimeSignedIn;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}
