import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Route, RouterModule } from '@angular/router';
import { UsersListComponent } from './users-list/users-list.component';
import { UserDetailsComponent } from './user-details/user-details.component';

export const routes: Route[] = [
  {
    path: '',
    component: UsersListComponent,
  },
  {
    path: ':id',
    component: UserDetailsComponent,
  },
  {
    path: '**',
    redirectTo: '',
  },
];
@NgModule({
  imports: [CommonModule, RouterModule.forChild(routes)],
  declarations: [UsersListComponent, UserDetailsComponent],
})
export class UsersModule {}
