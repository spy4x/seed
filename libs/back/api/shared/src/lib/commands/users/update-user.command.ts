import { IsBoolean, IsOptional, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AddUserDeviceDto } from '../../dto';
import { Type } from 'class-transformer';
import { USERNAME_RULES } from '@seed/shared/constants';

export class UpdateUserCommand {
  @IsOptional()
  @Length(USERNAME_RULES.minLength, USERNAME_RULES.maxLength, {
    message: `Username should be between ${USERNAME_RULES.minLength} and ${USERNAME_RULES.maxLength} characters`,
  })
  @ApiProperty()
  public userName?: string;

  @IsOptional()
  @ApiProperty()
  public firstName?: string;

  @IsOptional()
  @ApiProperty()
  public lastName?: string;

  @IsOptional()
  @ApiProperty()
  public photoURL?: string;

  @IsOptional()
  @ApiProperty()
  public userDevice?: AddUserDeviceDto;

  @ApiProperty()
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  public isPushNotificationsEnabled?: boolean;

  public id: string;

  constructor(
    id: string,
    userName?: string,
    firstName?: string,
    lastName?: string,
    photoURL?: string,
    userDevice?: AddUserDeviceDto,
    isPushNotificationsEnabled?: boolean,
  ) {
    this.id = id;
    this.userName = userName;
    this.firstName = firstName;
    this.lastName = lastName;
    this.photoURL = photoURL;
    this.userDevice = userDevice;
    this.isPushNotificationsEnabled = isPushNotificationsEnabled;
  }
}
