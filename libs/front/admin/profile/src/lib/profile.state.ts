import { createEntityFeatureFactory } from '@ngrx-traits/core';
import { addAsyncOperationTrait } from '../../../../shared/state/src/lib/asyncTrait';
import { props } from '@ngrx/store';
import { User } from '@prisma/client';

export const profileFeature = createEntityFeatureFactory(
  { entityName: 'profile' },
  addAsyncOperationTrait({
    name: 'update',
    runningProps: props<Partial<User>>(),
    successProps: props<Partial<User>>(),
    errorProps: props<{ message: string }>(),
  }),
)({
  actionsGroupKey: '[Profile]',
  featureSelector: 'profile',
});

export const ProfileActions = profileFeature.actions;
export const ProfileSelectors = profileFeature.selectors;
