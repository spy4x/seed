import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedAuthStateModule } from '@seed/front/shared/auth/state';
import { SharedAuthUIModule } from '@seed/front/shared/auth/ui';
import { SignInContainer } from './sign-in/sign-in.container';

@NgModule({
  imports: [CommonModule, SharedAuthStateModule, SharedAuthUIModule],
  declarations: [SignInContainer],
  exports: [SignInContainer],
})
export class SharedAuthContainerModule {}
