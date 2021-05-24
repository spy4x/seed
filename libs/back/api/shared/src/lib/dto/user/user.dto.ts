import { ApiProperty } from '@nestjs/swagger';

export class UserDto {
  constructor(
    public id: string,
    public userName: string,
    public firstName: string,
    public lastName: string,
    public photoURL: string | null,
  ) {}
}
export class UserDetailsDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userName: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty()
  photoURL: string | null;

  constructor(id: string, userName: string, firstName: string, lastName: string, photoURL: string | null) {
    this.id = id;
    this.userName = userName;
    this.firstName = firstName;
    this.lastName = lastName;
    this.photoURL = photoURL;
  }
}
