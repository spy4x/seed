import { NgModule } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { readFirst } from '@nrwl/angular/testing';

import { EffectsModule } from '@ngrx/effects';
import { StoreModule, Store } from '@ngrx/store';

import { NxModule } from '@nrwl/angular';

import { AuthEntity } from './auth.models';
import { AuthEffects } from './auth.effects';
import { AuthFacade } from './auth.facade';

import * as AuthSelectors from './auth.selectors';
import * as AuthActions from './auth.actions';
import { AUTH_FEATURE_KEY, State, initialState, reducer } from './auth.reducer';

interface TestSchema {
  auth: State;
}

describe('AuthFacade', () => {
  let facade: AuthFacade;
  let store: Store<TestSchema>;
  const createAuthEntity = (id: string, name = ''): AuthEntity => ({
    id,
    name: name || `name-${id}`,
  });

  describe('used in NgModule', () => {
    beforeEach(() => {
      @NgModule({
        imports: [StoreModule.forFeature(AUTH_FEATURE_KEY, reducer), EffectsModule.forFeature([AuthEffects])],
        providers: [AuthFacade],
      })
      class CustomFeatureModule {}

      @NgModule({
        imports: [NxModule.forRoot(), StoreModule.forRoot({}), EffectsModule.forRoot([]), CustomFeatureModule],
      })
      class RootModule {}
      TestBed.configureTestingModule({ imports: [RootModule] });

      store = TestBed.inject(Store);
      facade = TestBed.inject(AuthFacade);
    });

    /**
     * The initially generated facade::loadAll() returns empty array
     */
    it('loadAll() should return empty list with loaded == true', async done => {
      try {
        let list = await readFirst(facade.allAuth$);
        let isLoaded = await readFirst(facade.loaded$);

        expect(list.length).toBe(0);
        expect(isLoaded).toBe(false);

        facade.init();

        list = await readFirst(facade.allAuth$);
        isLoaded = await readFirst(facade.loaded$);

        expect(list.length).toBe(0);
        expect(isLoaded).toBe(true);

        done();
      } catch (err) {
        done.fail(err);
      }
    });

    /**
     * Use `loadAuthSuccess` to manually update list
     */
    it('allAuth$ should return the loaded list; and loaded flag == true', async done => {
      try {
        let list = await readFirst(facade.allAuth$);
        let isLoaded = await readFirst(facade.loaded$);

        expect(list.length).toBe(0);
        expect(isLoaded).toBe(false);

        store.dispatch(
          AuthActions.loadAuthSuccess({
            auth: [createAuthEntity('AAA'), createAuthEntity('BBB')],
          }),
        );

        list = await readFirst(facade.allAuth$);
        isLoaded = await readFirst(facade.loaded$);

        expect(list.length).toBe(2);
        expect(isLoaded).toBe(true);

        done();
      } catch (err) {
        done.fail(err);
      }
    });
  });
});
