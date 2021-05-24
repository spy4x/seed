import { User } from '.prisma/client';

export class UserSignedInEvent {
  constructor(public user: User) {}
}
