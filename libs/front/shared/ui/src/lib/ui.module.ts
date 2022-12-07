import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InputComponent } from './input/input.component';
import { ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from './button/button.component';
import { SeparatorComponent } from './separator/separator.component';
import { AlertComponent } from './alert/alert.component';
import { PaginationComponent } from './pagination/pagination.component';
import { LoadingComponent } from './loading/loading.component';

@NgModule({
  imports: [CommonModule, ReactiveFormsModule],
  declarations: [
    InputComponent,
    ButtonComponent,
    SeparatorComponent,
    AlertComponent,
    PaginationComponent,
    LoadingComponent,
  ],
  exports: [
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    SeparatorComponent,
    AlertComponent,
    PaginationComponent,
    LoadingComponent,
  ],
})
export class SharedUIModule {}
