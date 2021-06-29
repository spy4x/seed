import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SignInComponent } from './sign-in/sign-in.component';
import { ClipboardModule } from '@angular/cdk/clipboard';

@NgModule({
  imports: [CommonModule, ClipboardModule],
  declarations: [SignInComponent],
  exports: [SignInComponent],
})
export class SharedUIAuthModule {}
