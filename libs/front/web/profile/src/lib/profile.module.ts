import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Route, RouterModule } from '@angular/router';
import { ProfileComponent } from './profile/profile.component';
import { SharedAuthUIModule } from '@seed/front/shared/auth/ui';

export const routes: Route[] = [
  {
    path: '',
    component: ProfileComponent,
  },
  {
    path: '**',
    redirectTo: '',
  },
];

@NgModule({
  imports: [CommonModule, RouterModule.forChild(routes), SharedAuthUIModule],
  declarations: [ProfileComponent],
})
export class ProfileModule {}
