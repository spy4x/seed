import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SignInUIComponent } from './sign-in/sign-in.component';
import { ReactiveFormsModule } from '@angular/forms';
import { ProvidersListComponent } from './providers-list/providers-list.component';
import { EnterEmailComponent } from './enter-email/enter-email.component';
import { EnterPasswordComponent } from './enter-password/enter-password.component';
import { EnterPhoneNumberComponent } from './enter-phone-number/enter-phone-number.component';
import { DisplayUserComponent } from './display-prev-user/display-user.component';

@NgModule({
  imports: [CommonModule, ReactiveFormsModule],
  declarations: [
    SignInUIComponent,
    ProvidersListComponent,
    EnterEmailComponent,
    EnterPasswordComponent,
    EnterPhoneNumberComponent,
    DisplayUserComponent,
  ],
  exports: [SignInUIComponent],
})
export class SharedAuthUIModule {}
