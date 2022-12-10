import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Route, RouterModule } from '@angular/router';
import { ListComponent } from './list/list.component';
import { DetailComponent } from './detail/detail.component';
import { TableComponent } from './list/table/table.component';
import { FiltersComponent } from './list/filters/filters.component';
import { SharedUIModule } from '@seed/front/shared/ui';
import { EffectsModule } from '@ngrx/effects';
import { StoreModule } from '@ngrx/store';
import { usersFeature } from './list/list.state';
import { UsersEffects } from './list/list.effects';

export const routes: Route[] = [
  {
    path: '',
    component: ListComponent,
  },
  {
    path: ':id',
    component: DetailComponent,
  },
  {
    path: '**',
    redirectTo: '',
  },
];
@NgModule({
  imports: [
    CommonModule,
    RouterModule.forChild(routes),
    SharedUIModule,
    StoreModule.forFeature('users', usersFeature.reducer),
    EffectsModule.forFeature([UsersEffects, ...usersFeature.effects]),
  ],
  declarations: [ListComponent, DetailComponent, TableComponent, FiltersComponent],
})
export class UsersModule {}
