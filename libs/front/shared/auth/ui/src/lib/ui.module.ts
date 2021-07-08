import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SignInUIComponent } from './sign-in/sign-in.component';

@NgModule({
  imports: [CommonModule],
  declarations: [SignInUIComponent],
  exports: [SignInUIComponent],
})
export class SharedAuthUIModule {}
