import { StoreModule } from '@ngrx/store';
import { routerReducer, StoreRouterConnectingModule } from '@ngrx/router-store';
import { NgModule } from '@angular/core';
import { initialState, ROUTER_STATE_FEATURE_KEY } from './router.constants';
import { MicroRouterStateSerializer } from './router.serializer';

@NgModule({
  imports: [
    StoreModule.forFeature(ROUTER_STATE_FEATURE_KEY, routerReducer, { initialState }),
    StoreRouterConnectingModule.forRoot({
      stateKey: ROUTER_STATE_FEATURE_KEY,
      serializer: MicroRouterStateSerializer,
    }),
  ],
})
export class SharedRouterModule {}
