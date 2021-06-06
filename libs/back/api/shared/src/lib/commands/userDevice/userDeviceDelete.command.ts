export class UserDeviceDeleteCommand {
  id: string;

  constructor(id: string, public currentUserId: string) {
    this.id = id;
  }
}
