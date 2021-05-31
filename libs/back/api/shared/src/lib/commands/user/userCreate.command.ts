import { IsBoolean, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserDeviceCreateDTO } from '../../dtos';
import { Type } from 'class-transformer';
import { USERNAME_RULES } from '@seed/shared/constants';

export class UserCreateCommand {
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
  public userDevice?: UserDeviceCreateDTO;

  @ApiProperty()
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  public readonly isPushNotificationsEnabled?: boolean;

  public id: string;

  constructor(
    id: string,
    userName: string,
    firstName: string,
    lastName: string,
    userDevice?: UserDeviceCreateDTO,
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
