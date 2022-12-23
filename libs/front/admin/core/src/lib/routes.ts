// import { IsAuthorizedGuard, IsNotAuthorizedGuard } from '@seed/front/shared/auth/guards';
// import { ProtectedComponent } from './protected/protected.component';
import { provideRouter, RouterFeatures, Routes, withEnabledBlockingInitialNavigation } from '@angular/router';

const routes: Routes = [
  {
    path: 'invoices',
    loadChildren: () => import('@seed/front/admin/invoices').then(m => m.routes),
  },
  {
    path: 'contracts',
    loadChildren: () => import('@seed/front/admin/contracts').then(m => m.routes),
  },
  {
    path: '**',
    redirectTo: 'invoices',
  },
  // {
  //   path: 'auth',
  //   // eslint-disable-next-line @typescript-eslint/explicit-function-return-type,@typescript-eslint/promise-function-async
  //   loadChildren: () => import('@seed/front/admin/auth').then(m => m.AuthModule),
  //   canActivate: [IsNotAuthorizedGuard],
  // },
  // {
  //   path: '',
  //   component: ProtectedComponent,
  //   canActivate: [IsAuthorizedGuard],
  //   children: [
  //     {
  //       path: 'profile',
  //       // eslint-disable-next-line @typescript-eslint/explicit-function-return-type,@typescript-eslint/promise-function-async
  //       loadChildren: () => import('@seed/front/admin/profile').then(m => m.ProfileModule),
  //     },
  //     {
  //       path: 'users',
  //       // eslint-disable-next-line @typescript-eslint/explicit-function-return-type,@typescript-eslint/promise-function-async
  //       loadChildren: () => import('@seed/front/admin/users').then(m => m.UsersModule),
  //     },
  //     {
  //       path: '**',
  //       redirectTo: 'users',
  //     },
  //   ],
  // },
  // {
  //   path: '**',
  //   redirectTo: 'users',
  // },
];

const routerFeatures: RouterFeatures[] = [withEnabledBlockingInitialNavigation()];

export const router = provideRouter(routes, ...routerFeatures);
