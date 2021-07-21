# Seed


## Motivation. Why Seed❓
💡 After working on dozens of startup projects, I realised a pattern of applications/code/infrastructure that every startup needs.  
👨‍💻 Instead of repeating myself from project to project I decided to extract a project template into this seed.  
🏆 Now anyone can clone this repo and get all it's benefits for their startup.   
🌟 More about benefits in the Roadmap section.  


## Where to start? ▶️
0. Check README file (this one) to understand more about project structure and goals
0. Clone this repo and [init cloud infrastructure (WIP instruction)](docs/how-to-init-cloud-infrastructure.md) to configure your cloud & local environment
0. [Launch it locally and start development](docs/code-organisation/start-development.md)
0. [Deploy](cloud-build/deploy.yaml)
0. Profit 🌟


## Tools used ❤️

### Frontend:
<a href="https://angular.io/">  
  <img src="https://creativo-websolutions.com/my_files/2020/04/angular-logo.png" width="50" />
  <span>Angular</span>
</a>
<br/>

<a href="https://getbootstrap.com/">  
  <img src="https://www.svgrepo.com/show/303293/bootstrap-4-logo.svg" width="50" />
  <span>Bootstrap</span>
</a>
<br/>

### Backend:
<a href="https://nestjs.com/">  
  <img src="https://docs.nestjs.com/assets/logo-small.svg" width="50" />
  <span>Nest.js</span>
</a>
<br/>

<a href="https://www.postgresql.org/">  
  <img src="https://www.postgresql.org/media/img/about/press/elephant.png" width="50" />
  <span>PostgreSQL</span>
</a>
<br/>

<a href="https://www.docker.com/">  
  <img src="https://codeopolis.com/wp-content/uploads/2020/04/dockericon-e1587222605149.png" width="50" />
  <span>Docker</span>
</a>
<br/>

<a href="https://prisma.io/">  
  <img src="https://images.tute.io/tute/topic/prisma.png" width="50" />
  <span>Prisma</span>
</a>
<br/>

<a href="https://swagger.io/">  
  <img src="https://camo.githubusercontent.com/96e43701d83561899724a89d71187445b7b8f4fe84518a3ea5bec8f85bd207bf/68747470733a2f2f63646e2e737667706f726e2e636f6d2f6c6f676f732f737761676765722e737667" width="50" />
  <span>Swagger</span>
</a>
<br/>

### Clouds:
<a href="https://cloud.google.com/">  
  <img src="https://cdn.iconscout.com/icon/free/png-256/google-cloud-2038785-1721675.png" width="50" />
  <span>Google Cloud</span>
</a>
<br/>

<a href="https://firebase.google.com/">  
  <img src="https://cdn.iconscout.com/icon/free/png-256/firebase-1-282796.png" width="50" />
  <span>Firebase</span>
</a>
<br/>

### Environment and code organisation:
<a href="https://nx.dev">  
  <img src="https://images.opencollective.com/nx/0efbe42/logo/256.png" width="50" />
  <span>Nrwl Nx</span>
</a>
<br/>

<a href="https://www.cypress.io/">  
  <img src="https://iconape.com/wp-content/files/gj/370774/svg/370774.svg" width="50" />
  <span>Cypress</span>
</a>
<br/>

<a href="https://jestjs.io/">  
  <img src="https://d2eip9sf3oo6c2.cloudfront.net/tags/images/000/000/940/square_256/jestlogo.png" width="50" />
  <span>Jest</span>
</a>
<br/>

<a href="https://eslint.org/">  
  <img src="https://d33wubrfki0l68.cloudfront.net/204482ca413433c80cd14fe369e2181dd97a2a40/092e2/assets/img/logo.svg" width="50" />
  <span>ESLint</span>
</a>
<br/>

<a href="https://prettier.io/">  
  <img src="https://prettier.io/icon.png" width="50" />
  <span>Prettier</span>
</a>
<br/>

<a href="https://www.typescriptlang.org/">  
  <img src="https://d2zv2ciw0ln4h1.cloudfront.net/uploads/Typescript_logo_2020_0b0c45c9b6.svg" width="50" />
  <span>TypeScript</span>
</a>
<br/>


## Roadmap (What is implemented and what is not yet)
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
🕑 Manage commits (https://commitizen.github.io/cz-cli/ & https://brayanarrieta.hashnode.dev/integrate-commitizen-with-your-nodejs-project & https://brayanarrieta.hashnode.dev/how-to-automatically-generate-changelog-for-your-nodejs-projects-step-by-step  )  
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
✅ [Verify user JWT authentication](libs/back/api/shared/src/lib/nestjs/middlewares/user/user.middleware.ts)  
🕑 [Unit-testing controller](libs/back/api/users/src/lib/users.controller.spec.ts)  
✅ [Unit-testing command handler](libs/back/api/users/src/lib/commandHandlers/create/userCreate.commandHandler.spec.ts)  
✅ [Unit-testing query handler](libs/back/api/users/src/lib/queryHandlers/find/usersFind.queryHandler.spec.ts)  
🕑 [Unit-testing saga](libs/back/api/users/src/lib/sagas/userCreated.saga.spec.ts)  
🕑 E2E-testing endpoints  
✅ [Logging](libs/back/api/shared/src/lib/services/log/log.service.ts)  
🕑 Sentry integration  
✅ [Schedule tasks](libs/back/api/shared/src/lib/services/cloudTasks/cloudTasks.service.ts)  
✅ [Users management](libs/back/api/users/src/lib/users.controller.ts)  
✅ [REST API](libs/back/api/users/src/lib/users.controller.ts)  
🕑 GraphQL  
✅ Send Push notifications  
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
#### Shared
✅ [Authentication](libs/front/shared/auth)  
✅ [NgRx](libs/front/shared/auth/state)  
🕑 Sentry integration  
✅ [E2E-testing](libs/e2e/shared/auth/src/lib)  
✅ [Unit-testing UI components](libs/front/shared/auth/ui/src/lib)  
✅ [Unit-testing NgRx State](libs/front/shared/auth/state/src/lib/+state)  
✅ [Unit-testing Container component](libs/front/shared/auth/container/src/lib/sign-in)  
🕑 File upload  
🕑 Logging (Sentry or GCP Logging?)  
🕑 Provide environment variables from secret manager  
🕑 Build once, use bundle for every environment  
#### Styles
✅ Bootstrap  
🕑 own styles library  
🕑 mobile-first, responsive  
🕑 How to manage styles on component level? (no component-level styles)  
#### Forms & "Editor" component
🕑 Handle input & output better (prevent infinite cycle and dirty hacks to avoid it)  
🕑 Keep form state in store to be able to disable buttons based on form validity  
🕑 Understand form state (validation, submit, onBlur & submit)  
#### PWA
🕑 Offline work  
🕑 Push Notifications  
🕑 Auto-update
#### Admin Panel
🕑 Users management  
🕑 Groups management  
🕑 Reset user's password  
🕑 Sign in as a user  
#### Web Client
🕑 Multiple file upload with dropzone? (copy from FoodRazor Upload invoice)  
🕑 Server-side rendering  
🕑 User config management (organisations, currency settings, etc)  
🕑 Realtime update of data from backend  
🕑 Group access to data  
🕑 Different roles & permissions inside group users  
🕑 Manage your personal account - avatar, email, oAuth providers, groups memberships  
🕑 Manage group account - avatar, members, accesses  
🕑 Invite person to your group by email  
🕑 Transfer ownership of a group


## Credits
### Created by

<a href="https://github.com/spy4x">  
  <img src="https://avatars.githubusercontent.com/u/4995814?v=4" width="100" />
  <div>Anton Shubin</div>
</a>

### Special thanks to contributors:
<a href="https://github.com/MehdiDi">  
  <img src="https://avatars.githubusercontent.com/u/26252043?v=4" width="100" />
  <div>Mehdi Diabi</div>
</a>
<br/>

<a href="https://github.com/urnix">  
  <img src="https://avatars.githubusercontent.com/u/7656366?v=4" width="100" />
  <div>Artem</div>
</a>
<br/>

<a href="https://github.com/Eirene">  
  <img src="https://avatars.githubusercontent.com/u/1826433?v=4" width="100" />
  <div>Irina</div>
</a>
<br/>
