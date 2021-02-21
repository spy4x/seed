import { INestApplication } from '@nestjs/common/interfaces';
// import * as Sentry from '@sentry/node'; // TODO: Add Sentry
import * as expressLib from 'express';
import * as morgan from 'morgan';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import { API_CONFIG, LogSegment, LogService } from '@seed/back/api/shared';

import * as cors from 'cors';

let nest: INestApplication;
let express: expressLib.Application;
let logSegment: LogSegment;
type Output = { nest: INestApplication; express: expressLib.Application };
let instance: null | Output;

export async function getApp(): Promise<Output> {
  if (!instance) {
    logSegment = new LogService().startSegment(getApp.name);
    try {
      express = expressLib();

      // TODO: Add Sentry // Sentry.init({ dsn: environment.sentry.dsn });
      // TODO: Add Sentry // express.use(Sentry.Handlers.requestHandler()); // The request handler must be the first middleware on the app

      express.use(morgan(':method :url :status :response-time ms'));

      if (process.env.NODE_ENV !== 'production') {
        express.use(cors());
      }

      nest = await NestFactory.create(AppModule, new ExpressAdapter(express));
      nest.setGlobalPrefix(API_CONFIG.apiPrefix);

      // TODO: Add Sentry // express.use(Sentry.Handlers.errorHandler()); // The error handler must be before any other error middleware and after all controllers

      await nest.init();
      instance = { nest, express };
      logSegment.endWithSuccess();
      return instance;
    } catch (error) {
      logSegment.endWithFail(error);
      throw error;
    }
  }
  return instance;
}
