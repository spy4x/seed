import { INestApplication } from '@nestjs/common/interfaces';
import * as Sentry from '@sentry/node';
import * as Tracing from '@sentry/tracing';
import * as expressLib from 'express';
import * as morgan from 'morgan';
import { json } from 'body-parser';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import { API_CONFIG, isEnv, LogContext, LogSegment, LogService, LogSeverity } from '@seed/back/api/shared';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cors from 'cors';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { ZERO } from '@seed/shared/constants';
import { Environment } from '@seed/shared/types';

/* eslint-disable @typescript-eslint/no-require-imports */
// Mark some deps to be used explicitly. Workaround, because "generatePackageJson" from Nx doesn't detect them automatically.
require('reflect-metadata');
require('swagger-ui-express');
/* eslint-enable @typescript-eslint/no-require-imports */

let nest: null | INestApplication = null;
let express: null | expressLib.Application = null;

interface Output {
  nest: INestApplication;
  express: expressLib.Application;
}

let instance: null | Output = null;

function validationExceptionFactory(errors: ValidationError[]): Error {
  return new BadRequestException(
    errors.map(err => {
      const messages: string[] = [];

      for (const constraintKey in err.constraints) {
        if (Object.prototype.hasOwnProperty.call(err.constraints, constraintKey) && constraintKey) {
          messages.push(err.constraints[constraintKey]);
        }
      }
      return { property: err.property, error: messages };
    }),
  );
}

function configureSwagger(nestApp: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle(API_CONFIG.projectName)
    .setDescription(API_CONFIG.projectDescription)
    .setVersion(API_CONFIG.projectVersion)
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(nestApp, config);
  SwaggerModule.setup('api', nestApp, document);
}

function configureMorgan(expressApp: expressLib.Application): void {
  expressApp.use(
    morgan(
      (_tokens, req) => {
        const body = Object.keys(req.body).length === ZERO ? '' : LogService.inspect(req.body);
        return `${LogService.getIcon(LogSeverity.log, LogContext.startSegment)} ${req.method} ${req.url} ${body}`;
      },
      {
        immediate: true,
      },
    ),
  );
  expressApp.use(
    morgan(`${LogService.getIcon(LogSeverity.log, LogContext.finishSegment)} :method :url :status :response-time ms`),
  );
}

export async function getApp(): Promise<Output> {
  if (!instance) {
    const initInstance = async (logSegment: LogSegment): Promise<Output> => {
      logSegment.log(`API_CONFIG:`, API_CONFIG);

      express = expressLib();

      Sentry.init({
        dsn: API_CONFIG.sentryDSN,
        integrations: [
          new Sentry.Integrations.Http({ tracing: true }), // enable HTTP calls tracing
          new Tracing.Integrations.Express({ app: express }), // enable Express.js middleware tracing
        ],
        // Set tracesSampleRate to 1.0 to capture 100% of transactions for performance monitoring.
        // We recommend adjusting this value in production
        tracesSampleRate: 1.0,
      });
      express.use(Sentry.Handlers.requestHandler());
      express.use(Sentry.Handlers.tracingHandler());

      express.use(json());
      configureMorgan(express);

      if (!isEnv(Environment.production)) {
        express.use(cors());
      }

      nest = await NestFactory.create(AppModule, new ExpressAdapter(express));
      nest.setGlobalPrefix(API_CONFIG.apiPrefix);

      express.use(Sentry.Handlers.errorHandler()); // The error handler must be before any other error middleware and after all controllers

      configureSwagger(nest);

      nest.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true, // prevents extra properties to be attached to Request Body object that are not defined in DTOs
          exceptionFactory: validationExceptionFactory,
        }),
      );

      await nest.init();
      instance = { nest, express };
      return instance;
    };

    return new LogService(getApp.name).trackSegment<Output>(initInstance.name, initInstance);
  }
  return instance;
}
