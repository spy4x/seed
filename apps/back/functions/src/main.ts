import { environment } from './environments/environment';
import { NestApp } from './nest/app';

export * from './triggers/https';
export * from './triggers/onUserCreate';

async function initLocalDevelopment(): Promise<void> {
  const port = process.env.port || 3333;
  const { nestApp } = await NestApp.getInstance(true);
  await nestApp.listen(port, () => {
    console.log('Listening at http://localhost:' + port + '/' + NestApp.apiPrefix);
  });
}

if (!environment.production) {
  initLocalDevelopment();
}
