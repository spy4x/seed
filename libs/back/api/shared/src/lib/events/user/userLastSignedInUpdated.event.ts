import { User } from '.prisma/client';

export class UserLastSignedInUpdatedEvent {
  constructor(public user: User) {}
}
