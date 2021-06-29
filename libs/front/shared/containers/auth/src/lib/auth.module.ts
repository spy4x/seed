import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SignInContainer } from './sign-in/sign-in.container';
import { SharedStateAuthModule } from '@seed/front/shared/state/auth';
import { SharedUIAuthModule } from '@seed/front/shared/ui/auth';

@NgModule({
  imports: [CommonModule, SharedStateAuthModule, SharedUIAuthModule],
  declarations: [SignInContainer],
  exports: [SignInContainer],
})
export class SharedContainerAuthModule {}
