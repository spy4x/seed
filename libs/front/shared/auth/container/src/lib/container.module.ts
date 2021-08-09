import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedAuthUIModule } from '@seed/front/shared/auth/ui';
import { SignInContainerComponent } from './sign-in/sign-in.container';

@NgModule({
  imports: [CommonModule, SharedAuthUIModule],
  declarations: [SignInContainerComponent],
  exports: [SignInContainerComponent],
})
export class SharedAuthContainerModule {}
