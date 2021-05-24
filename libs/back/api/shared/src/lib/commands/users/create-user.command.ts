import { IsBoolean, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AddUserDeviceDto } from '../../dto';
import { Type } from 'class-transformer';
import { FIREBASE_AUTH_UID_LENGTH, USERNAME_RULES } from '@seed/shared/constants';

export class CreateUserCommand {
  @ApiProperty()
  @Length(FIREBASE_AUTH_UID_LENGTH, FIREBASE_AUTH_UID_LENGTH, {
    message: `User ID should be ${FIREBASE_AUTH_UID_LENGTH} characters long (Firebase Authentication UID).`,
  })
  public id: string;

  @ApiProperty()
  @IsNotEmpty({
    message: 'Username is required',
  })
  @Length(USERNAME_RULES.minLength, USERNAME_RULES.maxLength, {
    message: `Username should be between ${USERNAME_RULES.minLength} and ${USERNAME_RULES.maxLength} characters`,
  })
  @IsString()
  public readonly userName: string;

  @ApiProperty()
  @IsNotEmpty({
    message: 'firstName is required',
  })
  @IsString()
  public readonly firstName: string;

  @ApiProperty()
  @IsNotEmpty({
    message: 'lastName is required',
  })
  @IsString()
  public readonly lastName: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  public readonly photoURL?: string;

  @ApiProperty()
  @IsOptional()
  public userDevice?: AddUserDeviceDto;

  @ApiProperty()
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  public readonly isPushNotificationsEnabled?: boolean;

  constructor(
    id: string,
    userName: string,
    firstName: string,
    lastName: string,
    userDevice?: AddUserDeviceDto,
    photoURL?: string,
    isPushNotificationsEnabled?: boolean,
  ) {
    this.id = id;
    this.userName = userName;
    this.firstName = firstName;
    this.lastName = lastName;
    this.userDevice = userDevice;
    this.photoURL = photoURL;
    this.isPushNotificationsEnabled = isPushNotificationsEnabled;
  }
}
