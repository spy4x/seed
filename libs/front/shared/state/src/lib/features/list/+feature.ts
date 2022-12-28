import { createEntityAdapter, EntityAdapter } from '@ngrx/entity';
import {
  ListFeatureConfig,
  ListFeatureConfigWithoutAdapter,
  ListFeatureState,
  SetParamsArgs,
  SortDirection,
} from './+model';
import { createInitialState } from './initialState';
import { createSelectors } from './selectors';
import { createActionsAndReducer } from './actionsAndReducer';
import { Injectable } from '@angular/core';
import { Actions, concatLatestFrom, createEffect, ofType } from '@ngrx/effects';
import { filter, map, tap } from 'rxjs/operators';
import { routerNavigatedAction } from '@ngrx/router-store';
import { RouterSelectors, RouterState } from '@seed/front/shared/router';
import { Store } from '@ngrx/store';
import { ActivatedRoute, Params, Router } from '@angular/router';

export function withListFeature<T, TFilter>(c: ListFeatureConfigWithoutAdapter<T, TFilter>) {
  const adapter: EntityAdapter<T> = createEntityAdapter(c);
  const config: ListFeatureConfig<T, TFilter> = { adapter, ...c };

  return () => {
    const initialState = createInitialState(config);
    const selectors = createSelectors(config, initialState);
    const [actions, reducer] = createActionsAndReducer(config, initialState);

    // region Effects
    @Injectable()
    class EntitiesEffects {
      wasLoadedEver = false;

      loadUsers$ = createEffect(() =>
        this.actions$.pipe(
          ofType(
            actions.setPage,
            actions.setFilter,
            actions.patchFilter,
            actions.setSort,
            actions.setLimit,
            actions.setParams,
          ),
          concatLatestFrom(() => this.store.select(selectors.state)),
          tap(([, state]) => {
            this.updateURL(this.getQueryParamsFromState(state));
          }),
          map(() => actions.load()),
        ),
      );

      routeParams$ =
        config.routeParams &&
        createEffect(() =>
          this.actions$.pipe(
            ofType(routerNavigatedAction),
            filter(action => {
              /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
              return action.payload.routerState.url.startsWith(config.routeParams!.path);
            }),
            concatLatestFrom(() => [this.store.select(RouterSelectors.getState), this.store.select(selectors.state)]),
            filter(([, routerState, state]) => {
              if (!this.wasLoadedEver) {
                this.wasLoadedEver = true;
                return true;
              }
              return this.areURLParamsDifferFromState(routerState as unknown as RouterState, state);
            }),
            map(([, routerState, state]) =>
              actions.setParams(this.getParamsFromURL(routerState as unknown as RouterState, state)),
            ),
          ),
        );

      constructor(
        public readonly actions$: Actions,
        public readonly store: Store<ListFeatureState<T, TFilter>>,
        public readonly router: Router,
        public readonly activatedRoute: ActivatedRoute,
      ) {}

      updateURL(queryParams: Params): void {
        void this.router.navigate([], {
          relativeTo: this.activatedRoute,
          queryParams,
          queryParamsHandling: 'merge', // remove to replace all query params by provided
          replaceUrl: true,
        });
      }

      getParamsFromURL(routerState: RouterState, state: ListFeatureState<T, TFilter>): SetParamsArgs<T, TFilter> {
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
        const { filterDeserializer } = config.routeParams!;
        params.filter = filterDeserializer(routerState.queryParams);

        return params;
      }

      getQueryParamsFromState(state: ListFeatureState<T, TFilter>): Params {
        /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
        const { filterSerializer } = config.routeParams!;
        return {
          page: state.page,
          limit: state.limit,
          sortField: state.sort?.field,
          sortDirection: state.sort?.direction,
          ...filterSerializer(state.filter),
        };
      }

      areURLParamsDifferFromState(routerState: RouterState, state: ListFeatureState<T, TFilter>): boolean {
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

    // endregion

    return {
      initialState,
      actions,
      reducer,
      selectors,
      effects: [EntitiesEffects],
    };
  };
}
