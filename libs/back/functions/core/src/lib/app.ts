import { INestApplication } from '@nestjs/common/interfaces';
// import * as Sentry from '@sentry/node'; // TODO: Add Sentry
import * as express from 'express';
import * as morgan from 'morgan';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';

export class NestApp {
  public static apiPrefix = 'api';
  private static instance: NestApp;
  private static isInitiated = false;
  // @ts-ignore
  nestApp: INestApplication;
  // @ts-ignore
  expressApp: express.Application;

  /**
   * The Singleton's constructor should always be private to prevent direct
   * construction calls with the `new` operator.
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  public static async getInstance(isForHTTP: boolean): Promise<NestApp> {
    if (!NestApp.isInitiated) {
      console.log('No NestApp.instance yet. Initializing...');
      console.time('Init Nest');
      NestApp.instance = new NestApp();
      await NestApp.instance.init(isForHTTP);
      console.timeEnd('Init Nest');
    }
    return NestApp.instance;
  }

  private async init(isForHTTP: boolean): Promise<void> {
    try {
      // Sentry.init({ dsn: environment.sentry.dsn }); // TODO: Add Sentry
      if (isForHTTP) {
        // For HTTPS Cloud Function or local development
        this.expressApp = express();

        // The request handler must be the first middleware on the app
        // this.expressApp.use(Sentry.Handlers.requestHandler()); // errors logger middleware // TODO: Add Sentry
        this.expressApp.use(morgan(':method :url :status :response-time ms'));

        if (process.env.NODE_ENV !== 'production') {
          const cors = await import('cors');
          this.expressApp.use(cors());
        }

        this.nestApp = await NestFactory.create(AppModule, new ExpressAdapter(this.expressApp));
        this.nestApp.setGlobalPrefix(NestApp.apiPrefix);

        // The error handler must be before any other error middleware and after all controllers
        // this.expressApp.use(Sentry.Handlers.errorHandler()); // TODO: Add Sentry
      } else {
        // For Background Cloud Functions (like "OnUserCreate")
        this.nestApp = await NestFactory.create(AppModule);
      }

      await this.nestApp.init();
      NestApp.isInitiated = true;
    } catch (err) {
      console.error('Failed to init Nest', err);
    }
  }
}
