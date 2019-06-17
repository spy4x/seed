import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UserInfoComponent } from './user-info/user-info.component';

@NgModule({
  imports: [CommonModule],
  declarations: [UserInfoComponent],
  exports: [UserInfoComponent]
})
export class SharedComponentsModule {}
