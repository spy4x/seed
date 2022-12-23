import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AuthSelectors } from '@seed/front/shared/auth/state';
import { map } from 'rxjs/operators';
import { User } from '@prisma/client';
import { Store } from '@ngrx/store';

interface Link {
  title: string;
  url: string;
  icon: string;
}

@Component({
  selector: 'seed-admin-core-protected',
  templateUrl: `protected.component.html`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProtectedComponent {
  user$ = this.store.select(AuthSelectors.getUser).pipe(map(u => u as User));

  isMobileMenuOpened = false;

  links: Link[] = [
    {
      title: 'Users',
      url: '/users',
      icon: 'feather-users',
    },
  ];

  constructor(readonly store: Store) {}

  toggleMobileMenu(isOpened?: boolean): void {
    this.isMobileMenuOpened = isOpened ?? !this.isMobileMenuOpened;
  }
}
