import { INestApplication } from '@nestjs/common/interfaces';
import * as Sentry from '@sentry/node';
import * as express from 'express';
import * as morgan from 'morgan';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import { environment } from '../environments/environment';

export class NestApp {
  private static instance: NestApp;
  // @ts-ignore
  nestApp: INestApplication;
  // @ts-ignore
  expressApp: express.Application;
  public static apiPrefix = 'api';

  /**
   * The Singleton's constructor should always be private to prevent direct
   * construction calls with the `new` operator.
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  public static async getInstance(isForHTTP: boolean): Promise<NestApp> {
    if (!NestApp.instance) {
      NestApp.instance = new NestApp();
      await NestApp.instance.init(isForHTTP);
    }
    return NestApp.instance;
  }

  private async init(isForHTTP: boolean): Promise<void> {
    try {
      Sentry.init({ dsn: environment.sentry.dsn });
      if (isForHTTP) {
        // For HTTPS Cloud Function or local development
        this.expressApp = express();

        // The request handler must be the first middleware on the app
        this.expressApp.use(Sentry.Handlers.requestHandler()); // errors logger middleware
        this.expressApp.use(morgan(':method :url :status :response-time ms')); // http requests logger middleware

        this.nestApp = await NestFactory.create(AppModule, new ExpressAdapter(this.expressApp));
        this.nestApp.setGlobalPrefix(NestApp.apiPrefix);

        // The error handler must be before any other error middleware and after all controllers
        this.expressApp.use(Sentry.Handlers.errorHandler());

        await this.nestApp.init();
      } else {
        // For Background Cloud Functions (like "OnUserCreate")
        this.nestApp = await NestFactory.create(AppModule);
      }

      await this.nestApp.init();
    } catch (err) {
      console.error('Failed to init Nest', err);
    }
  }
}
