import { IsBoolean, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
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

  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  public readonly photoURL: null | string;

  @ApiProperty({ type: Boolean, required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  public readonly isPushNotificationsEnabled: boolean;

  constructor(
    public id: string,
    userName: string,
    firstName: string,
    lastName: string,
    photoURL?: string,
    isPushNotificationsEnabled?: boolean,
  ) {
    this.userName = userName;
    this.firstName = firstName;
    this.lastName = lastName;
    this.photoURL = photoURL || null;
    this.isPushNotificationsEnabled = isPushNotificationsEnabled || false;
  }
}
