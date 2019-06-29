# How to X?

Here you'll find answers for variety of technical questions. 

## Common:
* How to init infrastucture for the Seed? (Configure Firebase project, setup secret keys, README, etc)
* How to run project locally? With SSR? Different apps?
* How to build the project?
* How to deploy application to hosting?
* How to structure Angular + Firebase project?
* How to share code between frontend and backend?
* How to configure .editorconfig?
* How to configure .gitignore?
* How to configure package.json?
* How to configure TypeScript?
* How to configure TSLint?
* How to configure Prettier?
* How to configure all dependencies properly? Lerna/Yarn?
* How to control code quality? (git hooks)
* Useful dev scripts and snippets
* How to manage models/entities? (BaseEntity {id, created by/at, updated by/at, isDeleted:boolean})
* Put Release number to frontend/backend/website/etc for debug purposes
* How to integrate Stripe subscriptions/payments?
* How to integrate PayPal subscriptions/payments?

## Angular:
* How to manage multiple Angular applications and shared modules?
* How to minimize amount of Angular polyfills for modern browsers?
* How to structure an Angular application access-based? (public, onboarding and protected)
* How to configure Angular CLI behaviour? ChangeDetectionStrategy, ViewEncapsulation, no component-level styles, cli budgets
* How to setup and write E2E-tests with Cypress?
* How to setup and write Unit-tests with Jest?
* How to log errors?
* How to use Pug.js instead of HTML for components?
* How to record user session on frontend?
* How to manage authentication on frontend?
* How to create NgRx-architecture? (ngrx folder, use NgRx Entity and other modern tools, ListState<T>, check both FoodRazor & GoPingu. Can we do self-registered Effects?)
* Add "ngrx-store-freeze" for dev and test environment
* How to rehydrate NgRx-state?
* How to manage Reactive Forms and NgRx?
* How to implement proper "editor" component for an entity?
	1. Handle input & output better (prevent infinite cycle and dirty hacks to avoid it)
	2. Keep form state in store to be able to disable buttons based on form validity
	3. Understand form state (validation, submit, onBlur & submit)
* How to manage Service layer to do CRUD operations, file uploads, etc? (DatabaseService)
* How to manage multiple file upload with dropzone? (copy from FoodRazor Upload invoice)
* How to use Angular Material Design library/Bootstrap/Bulma?
* How to make app responsive, mobile-first approach? (CSS Grid, CSS Flex, breakpointObserver)
* How to manage mobile version gestures? (GoPingu, Hammer.js)
* How to manage and reuse Angular Animations and transitions?
* How to implement Google auth?
* How to implement Password auth?
* How to implement "user password change"?
* How to implement "user forgot password"?
* How to implement "user verify email"?
* How to manage routing?
* How to manage environment variables?
* How to manage styles? (SASS, no component-level styles)
* How to show nice initial loader on app start? (index.html)
* How to implement server-side rendering?
* How to manage user config? (current group, currency, etc) 
* How to make Progressive Web Application (PWA)?
* How to make SafePipe to manage sanitized content? (HTML insert, etc, GoPingu SafePipe)
* CI - Angular - Build once, use bundle for every environment
* Unsubscribe from Firestore Observables on page exit

## Firebase:

## Common:
* How to manage firebase.json configuration?
* How to store and insert demo data?

## Functions:
* How to manage architecture? (Nest.js?)
* How to manage file uploads and trigger functions for it?
* How to watch over execution of serverless functions?
* How to restart serverless function?
* How to have background tasks and watch their status?
* How to setup and write Unit-tests with Jest?
* How to log errors?
* How to manage environment variables/config? Per module? (Module Payments needs Stripe secret key, how to manage it so module could be add/removed together with all related secret keys/configs?)
* How to manage counters?
* How to handle Firestore transactions properly?
* How to send emails with SendGrid?
* How to manage Service layer to do CRUD operations, file uploads, etc? (DatabaseService)

## Firestore:
* How to store, build, test & deploy Firestore indexes?
* How to store, build, test & deploy Firestore security rules?
* How to configure backups of Firestore database?
* How to migrate Firestore database?
Storage:
* How to manage Firebase Cloud Storage security rules?
