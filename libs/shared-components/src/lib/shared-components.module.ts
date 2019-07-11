import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UserInfoComponent } from './user-info/user-info.component';

/**
 * Shared UI components used in frontend applications
 */
@NgModule({
  declarations: [UserInfoComponent],
  exports: [UserInfoComponent],
  imports: [CommonModule]
})
export class SharedComponentsModule {}
