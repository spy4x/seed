import { Action, MemoizedSelector, Selector } from '@ngrx/store';
import { Type } from '@angular/core';
import { ActionCreator, SelectorWithProps, TypedAction } from '@ngrx/store/src/models';

export interface StateConfig {
  name: string;
}

export declare type Actions = {
  [key: string]: ActionCreator<string, (...args: any[]) => TypedAction<string>>;
};
export declare type Selectors<State> = {
  [key: string]: Selector<State, any> | SelectorWithProps<State, any, any> | MemoizedSelector<State, any>;
};

export interface State<T> {
  actions: Actions;
  selectors: Selectors<T>;
  reducer: (state: T, action: Action) => T;
  effects: Type<unknown>[];
}

export type StateFeatureName = string;

export interface FeatureConfig<
  State = any,
  // A extends Actions = any,
  // S extends Selectors<State> = any,
  C = any,
> {
  name: StateFeatureName;
  depends?: StateFeatureName[];
  prefix?: string;
  config: C;
  create: () => StateFeatureFactory<State, /*A, S, */ C>;
}

export interface FeatureFactory {
  initialState: any;
  actions: any;
  reducer: any;
  selectors: any;
  effects: any[];
}

export type StateFeatureFactory<
  T = unknown,
  // A extends Actions = Actions,
  // S extends Selectors<T> = Selectors<T>,
  C extends any = any,
> = (config: C) => State<T>;
