import { INestApplication } from '@nestjs/common/interfaces';
import * as Sentry from '@sentry/node';
import * as expressLib from 'express';
import * as morgan from 'morgan';
import * as chalk from 'chalk';
import { json } from 'body-parser';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import { API_CONFIG, chalkify, Environment, isEnv, LogService } from '@seed/back/api/shared';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import * as cors from 'cors';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';

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
        if (constraintKey) {
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

export async function getApp(): Promise<Output> {
  if (!instance) {
    const initInstance = async (): Promise<Output> => {
      express = expressLib();

      Sentry.init({ dsn: API_CONFIG.sentryDSN });
      express.use(Sentry.Handlers.requestHandler());

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

      express.use(Sentry.Handlers.errorHandler()); // The error handler must be before any other error middleware and after all controllers

      configureSwagger(nest);

      nest.useGlobalPipes(
        new ValidationPipe({
          transform: true,
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
