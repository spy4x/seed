import { ActionCreatorProps, NotAllowedCheck } from '@ngrx/store';
import { TypedAction } from '@ngrx/store/src/models';
import { ActionCreator } from 'ngrx-handlers';
import { ErrorDetails } from '@seed/shared/types';

export type ActionCreatorWithOptionalProps<T> = T extends undefined
  ? ActionCreator<string, () => TypedAction<string>>
  : ActionCreator<string, (props: T & NotAllowedCheck<T & object>) => T & TypedAction<string>>;

export interface AsyncOperationTraitConfig {
  name: string;
  runningProps?: ActionCreatorProps<object>;
  successProps?: ActionCreatorProps<object>;
  errorProps?: ActionCreatorProps<ErrorDetails>;
}
