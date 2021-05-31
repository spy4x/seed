import { User } from '.prisma/client';

export class UserCreatedEvent {
  constructor(public user: User) {}
}
