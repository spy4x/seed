import { FeatureConfig, State, StateConfig } from './model';

export function createState<T>(_config: StateConfig, ..._features: FeatureConfig[]): State<T> {
  const initialValue: State<T> = {
    actions: {},
    reducer: (state, _action) => state,
    selectors: {},
    effects: [],
  };
  return initialValue;
  // return features.reduce((acc, { config: featureConfig, create }) => {
  //   const feature = create(featureConfig);
  //   acc.actions = { ...acc.actions, ...feature.actions } as const;
  //   acc.selectors = { ...acc.selectors, ...feature.selectors } as const;
  //   acc.effects = [...acc.effects, ...feature.effects];
  //   acc.reducer = (state, action) => {
  //     const newState = feature.reducer(state, action);
  //     return acc.reducer(newState, action);
  //   };
  //   return acc;
  // }, initialValue);
}

//
// export function createStateFeature<
//   State = {},
//   A extends FeatureActions = {},
//   S extends FeatureSelectors<State> = {},
//   M extends FeatureStateMutators<State> = {},
//   KEY extends string = string,
//   C = unknown,
//   // KC extends AllFeatureConfigs = KeyedConfig<KEY, C>,
// >(f: {
//   name: StateFeatureName;
//   config?: C;
//   depends?: StateFeatureName[];
//   create: FeatureFactory<State, A, S, M, KEY, C, KC>;
//   actions?: FeatureActionsFactory<A, KC>;
//   selectors?: FeatureSelectorsFactory<State, S, KC>;
//   initialState?: FeatureInitialStateFactory<State, KC>;
//   mutators?: FeatureStateMutatorsFactory<State, M, KC>;
//   reducer?: FeatureReducerFactory<State, A, S, M, KC>;
//   effects?: FeatureEffectsFactory<State, A, S, KC>;
// }): FeatureFactory<State, A, S, M, KEY, C, KC> {
//   return f as FeatureFactory<State, A, S, M, KEY, C>;
// }
//
// export function createStateFeature(config: FeatureConfig): FeatureConfig {
//   return config;
// }
