import { INestApplication } from '@nestjs/common/interfaces';
// import * as Sentry from '@sentry/node'; // TODO: Add Sentry
import * as expressLib from 'express';
import * as morgan from 'morgan';
import * as chalk from 'chalk';
import { json } from 'body-parser';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import { API_CONFIG, chalkify, Environment, isEnv, LogService } from '@seed/back/api/shared';

import * as cors from 'cors';

let nest: null | INestApplication = null;
let express: null | expressLib.Application = null;
interface Output {
  nest: INestApplication;
  express: expressLib.Application;
}
let instance: null | Output = null;

export async function getApp(): Promise<Output> {
  if (!instance) {
    const initInstance = async (): Promise<Output> => {
      express = expressLib();

      // TODO: Add Sentry // Sentry.init({ dsn: environment.sentry.dsn });
      // TODO: Add Sentry // express.use(Sentry.Handlers.requestHandler()); // The request handler must be the first middleware on the app
      express.use(json());
      express.use(
        morgan(
          (_tokens, req) =>
            `${chalkify('REQ', chalk.bgCyan.black)} ${req.method} ${req.url} ${
              req.body ? LogService.inspect(req.body) : ''
            }`,
          {
            immediate: true,
          },
        ),
      );
      express.use(morgan(`${chalkify('RES', chalk.bgMagenta.black)} :method :url :status :response-time ms`));

      if (!isEnv(Environment.production)) {
        express.use(cors());
      }

      nest = await NestFactory.create(AppModule, new ExpressAdapter(express));
      nest.setGlobalPrefix(API_CONFIG.apiPrefix);

      // TODO: Add Sentry // express.use(Sentry.Handlers.errorHandler()); // The error handler must be before any other error middleware and after all controllers

      await nest.init();
      instance = { nest, express };
      return instance;
    };

    return new LogService(getApp.name).trackSegment<Output>(initInstance.name, initInstance);
  }
  return instance;
}
