import { TraitEffect, Type } from '@ngrx-traits/core';
import { EntitiesActions, EntitiesSelectors, EntitiesState, EntitiesTraitKeyedConfig, SetParamsArgs } from './model';
import { Injectable } from '@angular/core';
import { Actions, concatLatestFrom, createEffect, ofType } from '@ngrx/effects';
import { filter, map, tap } from 'rxjs/operators';
import { routerNavigatedAction } from '@ngrx/router-store';
import { RouterSelectors } from '@seed/front/shared/router';
import { RouterState } from '../../../../router/src/lib/router.state';
import { Store } from '@ngrx/store';
import { ActivatedRoute, Params, Router } from '@angular/router';

export function createEntitiesTraitEffects<T, TFilter>(
  allActions: EntitiesActions<T, TFilter>,
  allConfigs: EntitiesTraitKeyedConfig<T, TFilter>,
  allSelectors: EntitiesSelectors<T, TFilter>,
): Type<TraitEffect>[] {
  @Injectable()
  class EntitiesEffects extends TraitEffect {
    wasLoadedEver = false;

    loadUsers$ = createEffect(() =>
      this.actions$.pipe(
        ofType(
          allActions.setPage,
          allActions.setFilter,
          allActions.patchFilter,
          allActions.setSort,
          allActions.setLimit,
          allActions.setParams,
        ),
        concatLatestFrom(() => this.store.select(allSelectors.state)),
        tap(([, state]) => {
          this.updateURL(this.getQueryParamsFromState(state));
        }),
        map(() => allActions.load()),
      ),
    );

    routeParams$ =
      !!allConfigs.entities?.routeParamsPath &&
      createEffect(() =>
        this.actions$.pipe(
          ofType(routerNavigatedAction),
          filter(action => {
            console.log({ path: allConfigs.entities!.routeParamsPath!, url: action.payload.routerState.url });
            return action.payload.routerState.url.startsWith(allConfigs.entities!.routeParamsPath!);
          }),
          concatLatestFrom(() => [
            this.store.select(RouterSelectors.getRouterState),
            this.store.select(allSelectors.state),
          ]),
          filter(([, routerState, state]) => {
            if (!this.wasLoadedEver) {
              this.wasLoadedEver = true;
              return true;
            }
            return this.areURLParamsDifferFromState(routerState as unknown as RouterState, state);
          }),
          map(([, routerState, state]) =>
            allActions.setParams(this.getParamsFromURL(routerState as unknown as RouterState, state)),
          ),
        ),
      );

    constructor(
      protected override actions$: Actions,
      protected override store: Store<EntitiesState<T, TFilter>>,
      protected router: Router,
      protected activatedRoute: ActivatedRoute,
    ) {
      super();
    }

    updateURL(queryParams: Params) {
      this.router.navigate([], {
        relativeTo: this.activatedRoute,
        queryParams,
        queryParamsHandling: 'merge', // remove to replace all query params by provided
        // skipLocationChange: true,
        replaceUrl: true,
      });
    }

    getParamsFromURL(routerState: RouterState, state: EntitiesState<T, TFilter>): SetParamsArgs<T, TFilter> {
      const params: SetParamsArgs<T, TFilter> = {
        page: routerState?.queryParams?.['page'] || state.page,
        limit: routerState?.queryParams?.['limit'] || state.limit,
        sort: {
          field: routerState.queryParams?.['sortField'] || state.sort?.field,
          direction: routerState.queryParams?.['sortDirection'] || state.sort?.direction,
        },
      };
      // TODO: parse filter
      console.log({ ...params });
      return params;
    }

    getQueryParamsFromState(state: EntitiesState<T, TFilter>): Params {
      return {
        page: state.page,
        limit: state.limit,
        sortField: state.sort?.field,
        sortDirection: state.sort?.direction,
        // TODO: parse filter
      };
    }

    areURLParamsDifferFromState(routerState: RouterState, state: EntitiesState<T, TFilter>): boolean {
      const paramsFromURL = this.getParamsFromURL(routerState, state);
      if (paramsFromURL.page !== state.page) {
        return true;
      }
      if (paramsFromURL.limit !== state.limit) {
        return true;
      }
      if (paramsFromURL.sort?.field !== state.sort?.field) {
        return true;
      }
      if (paramsFromURL.sort?.direction !== state.sort?.direction) {
        return true;
      }
      return false;
    }
  }

  return [EntitiesEffects];
}
