import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedAuthStateModule } from '@seed/front/shared/auth/state';
import { SharedAuthUIModule } from '@seed/front/shared/auth/ui';
import { SignInContainerComponent } from './sign-in/sign-in.container';

@NgModule({
  imports: [CommonModule, SharedAuthStateModule, SharedAuthUIModule],
  declarations: [SignInContainerComponent],
  exports: [SignInContainerComponent],
})
export class SharedAuthContainerModule {}
