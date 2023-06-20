import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Route, RouterModule } from '@angular/router';
import { ProfileComponent } from './profile/profile.component';
import { SharedAuthUIModule } from '@seed/front/shared/auth/ui';
import { SharedUIModule } from '@seed/front/shared/ui';
import { StoreModule } from '@ngrx/store';
import { profileFeature } from './profile.state';

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
  imports: [
    CommonModule,
    RouterModule.forChild(routes),
    SharedAuthUIModule,
    SharedUIModule,
    StoreModule.forFeature('profile', profileFeature.reducer),
  ],
  declarations: [ProfileComponent],
})
export class ProfileModule {}
