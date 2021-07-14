import { NgModule } from '@angular/core';
import { Store, StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import * as fromAuth from './+state/auth.reducer';
import { AuthEffects } from './+state/auth.effects';
import * as AuthAPIActions from './+state/actions/api.actions';

@NgModule({
  imports: [
    StoreModule.forFeature(fromAuth.AUTH_FEATURE_KEY, fromAuth.reducer),
    EffectsModule.forFeature([AuthEffects]),
  ],
})
export class SharedAuthStateModule {
  constructor(store: Store) {
    store.dispatch(AuthAPIActions.init());
  }
}
