export class UserMeDTO {
  constructor(
    public id: string,
    public userName: string,
    public firstName: string,
    public lastName: string,
    public photoURL: string | null,
    public isPushNotificationsEnabled: boolean,
  ) {}
}
