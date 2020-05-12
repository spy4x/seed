import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';

@NgModule({
  imports: [BrowserModule, RouterModule.forRoot([], { initialNavigation: 'enabled' })],
  exports: [RouterModule],
})
export class CoreModule {}
