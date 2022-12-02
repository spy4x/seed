# Seed
**Full-stack startup monorepo template. Build your next startup idea with best practices from day 1!**

## 🤔 Motivation. Why Seed?
💡 After working on dozens of startup projects, I realised a pattern of applications/code/infrastructure that every startup needs.  
👨‍💻 Instead of repeating myself from project to project I decided to extract a project template into this seed.  
🏆 Now anyone can clone this repo and get all it's benefits for their startup.   
🌟 More about benefits in the [Roadmap section](#roadmap).  

## 📗 Table of Contents
1. [Prerequisites](#prerequisites)  
1. [Run it locally](#run-it-locally)  
1. [Tools used](#tools)  
1. [Roadmap](#roadmap)  
1. [Contribution](#contribution)  
1. [Credits](#credits)  


## <a name="prerequisites"></a> ☝️ Prerequisites
 You need to have next things:
1. [Docker](https://www.docker.com/get-started/) (tip: `brew install --cask docker`)
2. [Node.js](https://github.com/nvm-sh/nvm) (tip: `brew install nvm && nvm install 18`)
3. [Yarn](https://classic.yarnpkg.com/lang/en/) (tip: `npm i -g yarn`)
4. Clone this repo (tip: `git clone git@github.com:spy4x/seed.git`)
5. Install dependencies `yarn` and build essential docker images `yarn docker:init`. On first run it will download all dependencies, so grab your favourite coffee or tea while initialization magic happens ☕


## <a name="run-it-locally"></a> ▶️ Run it locally
1. Start all apps and local infrastructure with `yarn start`. 
2. Open in your browser:
   - Frontend: http://localhost:4200
   - Admin Panel: http://localhost:4201
   - Backend Swagger: http://localhost:8080/api


## <a name="tools"></a> ⚡ Tools used
<table style="text-align: center">
  <tr>
    <td>
      <a href="https://angular.io/" target="_blank"
        ><img
          src="https://angular.io/assets/images/logos/angular/angular.svg"
          width="75"
          alt="Angular"
          valign="middle"
        />
      </a>
    </td>
    <td>
      <a href="https://tailwindcss.com/" target="_blank"
        ><img
          src="https://upload.wikimedia.org/wikipedia/commons/d/d5/Tailwind_CSS_Logo.svg"
          width="75"
          alt="TailwindCSS"
          valign="middle"
      /></a>
    </td>
    <td>
      <a href="https://nestjs.com/" target="_blank"
        ><img src="https://docs.nestjs.com/assets/logo-small.svg" width="75" alt="Nest.js" valign="middle" />
      </a>
    </td>
    <td>
      <a href="https://www.postgresql.org/" target="_blank"
        ><img
          src="https://www.postgresql.org/media/img/about/press/elephant.png"
          width="75"
          alt="PostgreSQL"
          valign="middle"
        />
      </a>
    </td>
    <td>
      <a href="https://www.docker.com/" target="_blank"
        ><img
          src="https://codeopolis.com/wp-content/uploads/2020/04/dockericon-e1587222605149.png"
          width="75"
          alt="Docker"
          valign="middle"
        />
      </a>
    </td>
  </tr>
  <tr>
    <td>
      <a href="https://prisma.io/" target="_blank"
        ><img src="https://www.svgrepo.com/show/327488/prism.svg" width="75" alt="Prisma" valign="middle" />
      </a>
    </td>
    <td>
      <a href="https://swagger.io/" target="_blank"
        ><img
          src="https://camo.githubusercontent.com/96e43701d83561899724a89d71187445b7b8f4fe84518a3ea5bec8f85bd207bf/68747470733a2f2f63646e2e737667706f726e2e636f6d2f6c6f676f732f737761676765722e737667"
          width="75"
          alt="Swagger"
          valign="middle"
      /></a>
    </td>
    <td>
      <a href="https://cloud.google.com/" target="_blank"
        ><img
          src="https://cdn.iconscout.com/icon/free/png-256/google-cloud-2038785-1721675.png"
          width="75"
          alt="Google Cloud"
          valign="middle"
        />
      </a>
    </td>
    <td>
      <a href="https://firebase.google.com/" target="_blank"
        ><img
          src="https://cdn.iconscout.com/icon/free/png-256/firebase-1-282796.png"
          width="75"
          alt="Firebase"
          valign="middle"
        />
      </a>
    </td>
    <td>
      <a href="https://nx.dev" target="_blank"
        ><img
          src="https://images.opencollective.com/nx/0efbe42/logo/256.png"
          width="75"
          alt="Nrwl Nx"
          valign="middle"
        />
      </a>
    </td>
  </tr>
  <tr>
    <td>
      <a href="https://www.cypress.io/" target="_blank"
        ><img
          src="https://iconape.com/wp-content/files/gj/370774/svg/370774.svg"
          width="75"
          alt="Cypress"
          valign="middle"
        />
      </a>
    </td>
    <td>
      <a href="https://jestjs.io/" target="_blank"
        ><img
          src="https://d2eip9sf3oo6c2.cloudfront.net/tags/images/000/000/940/square_256/jestlogo.png"
          width="75"
          alt="Jest"
          valign="middle"
      /></a>
    </td>
    <td>
      <a href="https://eslint.org/" target="_blank"
        ><img
          src="https://d33wubrfki0l68.cloudfront.net/204482ca413433c80cd14fe369e2181dd97a2a40/092e2/assets/img/logo.svg"
          width="75"
          alt="ESLint"
          valign="middle"
        />
      </a>
    </td>
    <td>
      <a href="https://prettier.io/" target="_blank"
        ><img src="https://prettier.io/icon.png" width="75" alt="Prettier" valign="middle" />
      </a>
    </td>
    <td>
      <a href="https://www.typescriptlang.org/" target="_blank"
        ><img
          src="https://d2zv2ciw0ln4h1.cloudfront.net/uploads/Typescript_logo_2020_0b0c45c9b6.svg"
          width="75"
          alt="TypeScript"
          valign="middle"
        />
      </a>
    </td>
  </tr>
</table>


## <a name="roadmap"></a> 🎯 Roadmap
What is implemented and what is planned.

### Environment and code organisation
✅ [Manage monorepo with multiple frontend and backend projects](docs/code-organisation/nx.md)  
✅ Running everything locally with a single command - `$ yarn start`  
✅ [Deploying apps to the cloud](cloud-build/deploy.yaml)  
✅ [TypeScript config (strict rules)](tsconfig.base.json)  
✅ [ESLint config (strict rules)](.eslintrc.json)  
✅ [Prettier config](.prettierrc)  
✅ [Pre-commit hook](package.json) for code quality control  
✅ Deploy to production with a single command - `$ yarn deploy:all`  
🕑 [CI/CD](https://github.com/spy4x/seed/issues/143)  
🕑 [Manage environments on local machine](https://github.com/spy4x/seed/issues/99)  
🕑 [Follows "12 Factor App"](https://github.com/spy4x/seed/issues/156)  
🕑 [Calculate affected apps based on latest release tag](https://github.com/spy4x/seed/issues/153)  
🕑 Staging environment    
🕑 [Manage commits](https://github.com/spy4x/seed/issues/154)  
🕑 [Update versions](https://github.com/spy4x/seed/issues/155) 

### Backend
✅ [Backend infrastructure diagram](docs/backend/infrastructure.md)  
✅ [Cloud Run](apps/back/api)  
✅ [Nest.js](libs/back/api/core/src/lib/app.ts)  
✅ [Prisma](prisma/schema.prisma)  
✅ [Configure Swagger integration with Nest.js](libs/back/api/core/src/lib/app.ts)  
✅ [CQRS architecture](docs/backend/cqrs.md)  
✅ [Verify user JWT authentication](libs/back/api/shared/src/lib/nestjs/middlewares/user-id/user-id.middleware.ts)  
🕑 [Unit-testing controller](https://github.com/spy4x/seed/issues/157)  
✅ [Unit-testing command handler](libs/back/api/users/src/lib/commandHandlers/create/userCreate.commandHandler.spec.ts)  
✅ [Unit-testing query handler](libs/back/api/users/src/lib/queryHandlers/find/usersFind.queryHandler.spec.ts)  
🕑 [Unit-testing event handler](libs/back/api/notifications/src/lib/eventHandlers/notificationCreated.eventHandler.spec.ts)  
🕑 [Load-testing](https://github.com/spy4x/seed/issues/119)  
✅ [Logging](libs/back/api/shared/src/lib/services/log/log.service.ts)  
✅ [Schedule tasks](libs/back/api/shared/src/lib/services/cloudTasks/cloudTasks.service.ts)  
✅ [Users management](libs/back/api/users/src/lib/users.controller.ts)  
✅ [REST API](libs/back/api/users/src/lib/users.controller.ts)  
✅ Send Push notifications  
🕑 [Http and Redis caching](https://github.com/spy4x/seed/issues/151)  
🕑 [Stripe subscriptions and payments](https://github.com/spy4x/seed/issues/158)  

#### Database
✅ [Automatic backups](https://cloud.google.com/sql/docs/postgres/backup-recovery/backups)  
✅ [Restore backup](https://cloud.google.com/sql/docs/postgres/backup-recovery/restoring)  
✅ [Read replicas](https://cloud.google.com/sql/docs/postgres/replication)  
🕑 [Automatic database migrations](https://github.com/spy4x/seed/issues/113)

#### Files upload
🕑 [Cloud Storage security rules](https://github.com/spy4x/seed/issues/58)  
🕑 [Handle upload](https://github.com/spy4x/seed/issues/58)  
🕑 [Keep track of files](https://github.com/spy4x/seed/issues/58)  
🕑 [Resize uploaded file](https://github.com/spy4x/seed/issues/58)  

### Frontend
#### Shared
✅ [Authentication](libs/front/shared/auth)  
✅ [NgRx](libs/front/shared/auth/state)  
✅ [E2E-testing](libs/e2e/shared/auth/src/lib)  
✅ [Unit-testing UI components](libs/front/shared/auth/ui/src/lib)  
✅ [Unit-testing NgRx State](libs/front/shared/auth/state/src/lib/+state)  
✅ [Unit-testing Container component](libs/front/shared/auth/container/src/lib/sign-in)  
🕑 [File upload](https://github.com/spy4x/seed/issues/58)  
🕑 [Logging](https://github.com/spy4x/seed/issues/146)  
🕑 [Build once, use bundle for every environment](https://github.com/spy4x/seed/issues/141)  
#### Styles
✅ TailwindCSS + Mobile-first responsive design
✅ [Styles shared between frontend apps](libs/front/shared/styles)  
#### PWA
🕑 [Offline work](https://github.com/spy4x/seed/issues/147)  
🕑 [Push Notifications](https://github.com/spy4x/seed/issues/147)  
🕑 [Auto-update](https://github.com/spy4x/seed/issues/147)  
🕑 [Installable](https://github.com/spy4x/seed/issues/147)
#### Admin Panel
🕑 [Users management](https://github.com/spy4x/seed/issues/131)  
🕑 [Groups management](https://github.com/spy4x/seed/issues/159)  
🕑 [Reset user's password](https://github.com/spy4x/seed/issues/134)   
#### Web Client
🕑 [Realtime update of data from backend](https://github.com/spy4x/seed/issues/160)  
🕑 [Group access to data](https://github.com/spy4x/seed/issues/159)  
🕑 [Manage your personal account - avatar, email, oAuth providers, groups memberships](https://github.com/spy4x/seed/issues/104)  
🕑 [Manage group account - avatar, members, accesses](https://github.com/spy4x/seed/issues/159)  
🕑 [Invite person to your group by email](https://github.com/spy4x/seed/issues/159)  
🕑 [Transfer ownership of a group](https://github.com/spy4x/seed/issues/159)


## <a name="contribution"></a> ➕ Contribution
Contributions are welcome, either it is a typo fix, bug fix, feature proposal, a pull request or anything else!  
For more info follow [contributing guidelines](CONTRIBUTING.md).


## <a name="credits"></a> Credits
### 👻 Created by [Anton Shubin](https://github.com/spy4x)
<a href="https://github.com/spy4x">  
  <img src="https://avatars.githubusercontent.com/u/4995814?v=4" width="100" style="border-radius: 50%" />
</a>

### ❤️ Special thanks to contributors:
<table style="text-align: center">
  <tr>
    <td>
      <a href="https://github.com/MehdiDi" target="_blank"
        ><img
          src="https://avatars.githubusercontent.com/u/26252043?v=4"
          width="75"
          alt="Mehdi"
          valign="middle"
          style="border-radius: 50%"
        />
      </a>
    </td>
    <td>
      <a href="https://github.com/urnix" target="_blank"
        ><img
          src="https://avatars.githubusercontent.com/u/7656366?v=4"
          width="75"
          alt="Artem Ischenko"
          valign="middle"
          style="border-radius: 50%"
        />
      </a>
    </td>
    <td>
      <a href="https://github.com/Eirene" target="_blank"
        ><img
          src="https://avatars.githubusercontent.com/u/1826433?v=4"
          width="75"
          alt="Irina Sorokina"
          valign="middle"
          style="border-radius: 50%"
        />
      </a>
    </td>
  </tr>
</table>
