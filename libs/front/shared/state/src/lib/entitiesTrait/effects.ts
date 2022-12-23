import { TraitEffect, Type } from '@ngrx-traits/core';
import {
  EntitiesActions,
  EntitiesFilter,
  EntitiesSelectors,
  EntitiesState,
  EntitiesTraitKeyedConfig,
  SetParamsArgs,
  SortDirection,
} from './model';
import { Injectable } from '@angular/core';
import { Actions, concatLatestFrom, createEffect, ofType } from '@ngrx/effects';
import { filter, map, tap } from 'rxjs/operators';
import { routerNavigatedAction } from '@ngrx/router-store';
import { RouterSelectors, RouterState } from '@seed/front/shared/router';
import { Store } from '@ngrx/store';
import { ActivatedRoute, Params, Router } from '@angular/router';

/* eslint-disable-next-line max-lines-per-function */
export function createEntitiesTraitEffects<T, TFilter extends EntitiesFilter>(
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
      !!allConfigs.entities?.routeParams &&
      createEffect(() =>
        this.actions$.pipe(
          ofType(routerNavigatedAction),
          filter(action => {
            // console.log({ path: allConfigs.entities!.routeParamsPath!, url: action.payload.routerState.url });
            /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
            return action.payload.routerState.url.startsWith(allConfigs.entities!.routeParams!.path);
          }),
          concatLatestFrom(() => [this.store.select(RouterSelectors.getState), this.store.select(allSelectors.state)]),
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

    updateURL(queryParams: Params): void {
      void this.router.navigate([], {
        relativeTo: this.activatedRoute,
        queryParams,
        queryParamsHandling: 'merge', // remove to replace all query params by provided
        // skipLocationChange: true,
        replaceUrl: true,
      });
    }

    getParamsFromURL(routerState: RouterState, state: EntitiesState<T, TFilter>): SetParamsArgs<T, TFilter> {
      const params: SetParamsArgs<T, TFilter> = {};

      if (routerState.queryParams['page'] && +routerState.queryParams['page']) {
        params.page = +routerState.queryParams['page'];
      }

      if (routerState.queryParams['limit'] && +routerState.queryParams['limit']) {
        params.limit = +routerState.queryParams['limit'];
      }

      const paramSortField = routerState.queryParams['sortField'] as string | undefined;
      const paramSortDirection = routerState.queryParams['sortDirection'] as string | undefined;
      if (paramSortField) {
        params.sort = {
          field: paramSortField as keyof T,
          direction:
            paramSortDirection && ['asc', 'desc'].includes(paramSortDirection)
              ? (paramSortDirection as SortDirection)
              : 'asc',
        };
      } else if (state.sort) {
        params.sort = {
          field: state.sort.field,
          direction: state.sort.direction,
        };
      }

      /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
      const { filterDeserializer } = allConfigs.entities!.routeParams!;
      params.filter = filterDeserializer(routerState.queryParams);

      return params;
    }

    getQueryParamsFromState(state: EntitiesState<T, TFilter>): Params {
      /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
      const { filterSerializer } = allConfigs.entities!.routeParams!;
      return {
        page: state.page,
        limit: state.limit,
        sortField: state.sort?.field,
        sortDirection: state.sort?.direction,
        ...filterSerializer(state.filter),
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
