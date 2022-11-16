import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProvidersListComponent } from './providers-list.component';
import { AuthProvider } from '@seed/front/shared/types';
import { ChangeDetectionStrategy, DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { difference } from 'lodash-es';
import { first } from 'rxjs/operators';
import { SharedUIModule } from '@seed/front/shared/ui';

describe(ProvidersListComponent.name, () => {
  // region SETUP
  let component: ProvidersListComponent;
  let fixture: ComponentFixture<ProvidersListComponent>;
  const ALL_PROVIDERS = (Object.keys(AuthProvider) as AuthProvider[]).filter(am => am !== AuthProvider.anonymous);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ProvidersListComponent],
      imports: [SharedUIModule],
    })
      .overrideComponent(ProvidersListComponent, {
        set: { changeDetection: ChangeDetectionStrategy.Default }, // To make fixture.detectChanges() work
      })
      .compileComponents();
    fixture = TestBed.createComponent(ProvidersListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function getProviderButton(provider: AuthProvider): DebugElement {
    return fixture.debugElement.query(By.css(`button[data-e2e="${provider}"]`));
  }

  function renderTest(providers: AuthProvider[]): void {
    it(`shows providers: ${providers.join(', ')}`, () => {
      component.providers = providers;
      fixture.detectChanges();
      providers.forEach(p => expect(getProviderButton(p)).toBeTruthy());
      difference(ALL_PROVIDERS, providers).forEach(p => expect(getProviderButton(p)).toBeFalsy());
    });
  }

  function emitTest(provider: AuthProvider): void {
    it(`emits "select" event on click on "${provider}" button`, done => {
      component.providers = ALL_PROVIDERS;
      fixture.detectChanges();
      component.provider.pipe(first()).subscribe(p => {
        expect(p).toEqual(provider);
        done();
      });
      getProviderButton(provider).nativeElement.click();
    });
  }
  // endregion

  renderTest([AuthProvider.link, AuthProvider.password]);
  renderTest([AuthProvider.github, AuthProvider.google, AuthProvider.phone]);
  renderTest(ALL_PROVIDERS);
  ALL_PROVIDERS.forEach(p => emitTest(p));
});
