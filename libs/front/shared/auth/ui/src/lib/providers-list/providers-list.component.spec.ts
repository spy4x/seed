import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProvidersListComponent } from './providers-list.component';
import { AuthProvider } from '@seed/front/shared/types';
import { ChangeDetectionStrategy, DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { difference } from 'lodash-es';
import { first } from 'rxjs/operators';

describe(ProvidersListComponent.name, () => {
  // region SETUP
  let component: ProvidersListComponent;
  let fixture: ComponentFixture<ProvidersListComponent>;
  const ALL_PROVIDERS = (Object.keys(AuthProvider) as AuthProvider[]).filter(am => am !== AuthProvider.anonymous);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ProvidersListComponent],
    })
      .overrideComponent(ProvidersListComponent, {
        set: { changeDetection: ChangeDetectionStrategy.Default }, // To make fixture.detectChanges() work
      })
      .compileComponents();
    fixture = TestBed.createComponent(ProvidersListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function getProviderButton(method: AuthProvider): DebugElement {
    return fixture.debugElement.query(By.css(`button[data-e2e="${method}"]`));
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
      component.select.pipe(first()).subscribe(method => {
        expect(method).toEqual(provider);
        done();
      });
      getProviderButton(provider).nativeElement.click();
    });
  }

  function loadingTest(provider: AuthProvider): void {
    it(`shows loading on "${provider}" button and disables other buttons`, () => {
      component.providers = ALL_PROVIDERS;
      component.selectedProvider = provider;
      fixture.detectChanges();
      expect(getProviderButton(provider).nativeElement.textContent).not.toContain('Loading');
      ALL_PROVIDERS.forEach(p => expect(getProviderButton(p).nativeElement.disabled).toBe(false));
      // change
      component.inProgress = true;
      fixture.detectChanges();
      expect(getProviderButton(provider).nativeElement.textContent).toContain('Loading');
      ALL_PROVIDERS.forEach(p => expect(getProviderButton(p).nativeElement.disabled).toBe(true));
    });
  }
  // endregion

  renderTest([AuthProvider.link, AuthProvider.password]);
  renderTest([AuthProvider.github, AuthProvider.google, AuthProvider.phone]);
  renderTest(ALL_PROVIDERS);
  ALL_PROVIDERS.forEach(p => emitTest(p));
  [AuthProvider.github, AuthProvider.google, AuthProvider.link].forEach(p => loadingTest(p));
});
