import { IsBoolean, IsOptional, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { USERNAME_RULES } from '@seed/shared/constants';

export class UserUpdateCommand {
  @ApiProperty({ type: String, required: false })
  @Length(USERNAME_RULES.minLength, USERNAME_RULES.maxLength, {
    message: `Username should be between ${USERNAME_RULES.minLength} and ${USERNAME_RULES.maxLength} characters`,
  })
  @IsOptional()
  public userName?: string;

  @ApiProperty({ type: String, required: false })
  @IsOptional()
  public firstName?: string;

  @ApiProperty({ type: String, required: false })
  @IsOptional()
  public lastName?: string;

  @ApiProperty({ type: String, required: false })
  @IsOptional()
  public photoURL?: string;

  @ApiProperty({ type: Boolean, required: false })
  @IsBoolean()
  @Type(() => Boolean)
  @IsOptional()
  public isPushNotificationsEnabled?: boolean;

  constructor(
    public id: string,
    userName?: string,
    firstName?: string,
    lastName?: string,
    photoURL?: string,
    isPushNotificationsEnabled?: boolean,
  ) {
    this.userName = userName;
    this.firstName = firstName;
    this.lastName = lastName;
    this.photoURL = photoURL;
    this.isPushNotificationsEnabled = isPushNotificationsEnabled;
  }
}
