# Seed

## Motivation. Why Seed❓
💡 After working on dozens of startup projects, I realised a pattern of applications/code/infrastructure that every startup needs.  
👨‍💻 Instead of repeating myself from project to project I decided to extract a project template into this seed.  
🏆 Now anyone can clone this repo and get all it's benefits for their startup.   
🌟 More about benefits in the Roadmap section.  


## Where to start? ▶️
0. Check README file (this one) to understand more about project structure and goals
0. Clone this repo and run init script (WIP) to configure your cloud & local environment
0. Launch it locally and start development
0. Deploy
0. Profit 🌟



## Tools used ❤️
| [![Google Cloud](https://cloud.google.com/_static/cloud/images/social-icon-google-cloud-1200-630.png)](https://cloud.google.com/)  | [![Firebase](https://firebase.google.com/downloads/brand-guidelines/PNG/logo-vertical.png)](https://firebase.google.com/) | [![Nrwl Nx](https://raw.githubusercontent.com/nrwl/nx/master/nx-logo.png)](https://nx.dev) |
|:---:|:---:|:---:|
| [Google Cloud](https://cloud.google.com/) | [Firebase](https://firebase.google.com/) | [Nrwl Nx](https://nx.dev) |
| [![TypeScript](https://raw.githubusercontent.com/nrwl/nx/master/nx-logo.png)](https://nx.dev)  | [![Nest.js](https://docs.nestjs.com/assets/logo-small.svg)](https://nestjs.com/) | [![Angular](https://angular.io/assets/images/logos/angular/angular.png)](https://angular.io/) |
| [TypeScript](https://nx.dev) | [Nest.js](https://nestjs.com/) | [Angular](https://angular.io/) |

<div style="display: flex; text-align: center;">
  <a href="https://cloud.google.com/" target="_blank">  
    <img src="https://cloud.google.com/_static/cloud/images/social-icon-google-cloud-1200-630.png" width="250" />
    <span>Google Cloud</span>
  </a>
  <a href="https://cloud.google.com/" target="_blank">  
    <img src="https://cloud.google.com/_static/cloud/images/social-icon-google-cloud-1200-630.png" width="250" />
    <span>Google Cloud</span>
  </a>
  <a href="https://cloud.google.com/" target="_blank">  
    <img src="https://cloud.google.com/_static/cloud/images/social-icon-google-cloud-1200-630.png" width="250" />
    <span>Google Cloud</span>
  </a>
</div>


<p float="left">
  <a href="https://cloud.google.com/" target="_blank">  
    <img src="https://cloud.google.com/_static/cloud/images/social-icon-google-cloud-1200-630.png" width="250" />
    <span>Google Cloud</span>
  </a>
  <a href="https://cloud.google.com/" target="_blank">  
    <img src="https://cloud.google.com/_static/cloud/images/social-icon-google-cloud-1200-630.png" width="250" />
    <span>Google Cloud</span>
  </a>
  <a href="https://cloud.google.com/" target="_blank">  
    <img src="https://cloud.google.com/_static/cloud/images/social-icon-google-cloud-1200-630.png" width="250" />
    <span>Google Cloud</span>
  </a>
</p>

[Nrwl Nx](https://nx.dev) https://raw.githubusercontent.com/nrwl/nx/master/nx-logo.png     
[Nest.js](https://nestjs.com/) https://docs.nestjs.com/assets/logo-small.svg  
[Angular](https://angular.io/) https://angular.io/assets/images/logos/angular/angular.png
[Google Cloud](https://cloud.google.com/) https://cloud.google.com/_static/cloud/images/social-icon-google-cloud-1200-630.png
[Firebase](https://firebase.google.com/) https://firebase.google.com/downloads/brand-guidelines/PNG/logo-vertical.png  

[Prisma](https://prisma.io/) https://seeklogo.com/images/P/prisma-logo-3805665B69-seeklogo.com.png  
TypeScript  
Cypress  
Jest  
ESLint  
Prettier  
Docker  
Swagger https://habrastorage.org/webt/s2/12/rf/s212rfhzbzzt4n_cwpezjqr9we8.png  
Bootstrap https://raboj.su/images/items/2019/01/Bootstrap-Logo.png  


## Roadmap
TODOs:
- Fill in "Tools used" section
- Refactor lines below
- Write /docs/backend/cqrs.md


### Environment and code organisation
✅ [Manage monorepo with multiple front-, back- and dev- projects](docs/code-organisation/nx.md)  
✅ [Launching apps on localhost](docs/code-organisation/start-development.md)  
✅ [Deploying apps to the cloud](cloud-build/deploy.yaml)  
✅ [TypeScript config (strict rules)](tsconfig.base.json)  
✅ [ESLint config (strict rules)](.eslintrc.json)  
✅ [Prettier config](.prettierrc)  
✅ Code quality control: [Pre-commit hook](package.json) and [CI/CD](cloud-build/check.yaml)  
🕑 Init whole project via script  
🕑 Keep secret keys safe in Google Cloud Secret Manager  
🕑 Keep secret keys safe on localhost  
🕑 Calculate affected apps based on latest release tag  
🕑 Staging environment  
🕑 E2E environment  
🕑 Manage commits (https://commitizen.github.io/cz-cli/)  
🕑 Update versions (https://github.com/jscutlery/semver) & Build numbers  
🕑 Add Stylelint (https://github.com/Phillip9587/nx-stylelint)  

### Backend
✅ [Backend infrastructure diagram](docs/backend/infrastructure.md)  
✅ [Cloud Run](apps/back/api)  
✅ [Cloud Functions](apps/back/cloud-functions)  
✅ [Nest.js](libs/back/api/core/src/lib/app.ts)  
✅ [Prisma](prisma/schema.prisma)  
✅ [Configure Swagger integration with Nest.js](libs/back/api/core/src/lib/app.ts)  
✅ [CQRS architecture](docs/backend/cqrs.md)  
✅ [Verify user JWT authentication](libs/back/api/shared/src/lib/middlewares/user/user.middleware.ts)  
🕑 [Unit-testing controller](libs/back/api/users/src/lib/users.controller.spec.ts)  
✅ [Unit-testing command handler](libs/back/api/users/src/lib/commandHandlers/create/userCreate.commandHandler.spec.ts)  
✅ [Unit-testing query handler](libs/back/api/users/src/lib/queryHandlers/find/usersFind.queryHandler.spec.ts)  
🕑 [Unit-testing saga](libs/back/api/users/src/lib/sagas/userCreated.saga.spec.ts)  
🕑 E2E-testing endpoints  
✅ Logging  
✅ [Schedule tasks](libs/back/api/shared/src/lib/services/cloudTasks/cloudTasks.service.ts)  
✅ [Users management](libs/back/api/users/src/lib/users.controller.ts)  
✅ [REST API](libs/back/api/users/src/lib/users.controller.ts)  
🕑 GraphQL  
🕑 Send Push notifications  
🕑 Http caching  
🕑 Redis caching  
🕑 How to integrate Stripe subscriptions/payments?  
#### Database
✅ [Automatic backups](https://cloud.google.com/sql/docs/postgres/backup-recovery/backups)  
✅ [Restore backup](https://cloud.google.com/sql/docs/postgres/backup-recovery/restoring)  
✅ [Read replicas](https://cloud.google.com/sql/docs/postgres/replication)  
🕑 When and how to migrate DB schema?  
#### Files upload
🕑 Cloud Storage security rules  
🕑 Handle upload  
🕑 Keep track of files  
🕑 Resize uploaded file  

### Frontend
🕑 Admin Panel  
🕑 Web Client  
🕑 Authentication  
🕑 NgRx  
  * How to create NgRx-architecture? (ngrx folder, use NgRx Entity and other modern tools, ListState<T>, check both FoodRazor & GoPingu. Can we do self-registered Effects?)
  * Add "ngrx-store-freeze" for dev and test environment
  * How to rehydrate NgRx-state?
  * How to manage Reactive Forms and NgRx?
🕑 E2E-testing  
🕑 Unit-testing  
🕑 File upload  
🕑 Logging (Sentry or GCP Logging?)
🕑 Provide environment variables from secret manager  
🕑 Build once, use bundle for every environment
🕑 Bootstrap & own styles library
  - mobile-first, responsive
  - How to manage styles? (SASS, no component-level styles)
  - How to show nice initial loader on app start? (index.html)
🕑 Forms & "Editor" component  
  1. Handle input & output better (prevent infinite cycle and dirty hacks to avoid it)
  2. Keep form state in store to be able to disable buttons based on form validity
  3. Understand form state (validation, submit, onBlur & submit)
* How to manage Service layer to do CRUD operations, file uploads, etc? (DatabaseService)
* How to manage multiple file upload with dropzone? (copy from FoodRazor Upload invoice)
* How to implement server-side rendering?
* How to manage user config? (organisations, currency settings, etc)

* How to implement Google auth?
* How to implement Password auth?
* How to implement "user password change"?
* How to implement "user forgot password"?
* How to implement "user verify email"?

* Realtime lists of todos - like Google Keep
* Group access - invite your friends and cowork on your lists together
* Share a list of todos to a person outside of your group or make it public
* Transfer ownership of a personal list to a group and visa versa
* Upload a txt/csv file with a list of todos
* Manage your personal account - avatar, email, oAuth providers, groups memberships
* Manage group account - avatar, members, accesses
* How to manage multiple Angular applications and shared modules?
#### PWA  
🕑 Offline work  
🕑 Push Notifications  
🕑 Auto-update


## Credits
### Created by
<div style="width: 100px; text-align: center; margin-right: 10px;">
  <img src="https://avatars.githubusercontent.com/u/4995814?v=4" style="border-radius: 50%">
  <a href="https://github.com/spy4x" target="_blank">Anton Shubin</a>
</div>

### Special thanks to contributors:
<div style="display: flex;">
  <div style="width: 100px; text-align: center; margin-right: 10px;">
    <img src="https://avatars.githubusercontent.com/u/26252043?v=4" style="border-radius: 50%">
    <a href="https://github.com/MehdiDi" target="_blank">Mehdi Diabi</a>
  </div>
  
  <div style="width: 100px; text-align: center;">
    <img src="https://avatars.githubusercontent.com/u/7656366?v=4" style="border-radius: 50%">
    <a href="https://github.com/urnix" target="_blank">Artem</a>
  </div>
</div>
