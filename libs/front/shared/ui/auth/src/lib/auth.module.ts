import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SignInComponent } from './sign-in/sign-in.component';

@NgModule({
  imports: [CommonModule],
  declarations: [SignInComponent],
  exports: [SignInComponent],
})
export class SharedUIAuthModule {}
