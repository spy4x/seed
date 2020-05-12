import * as functions from 'firebase-functions';
import { NestApp } from '../nest/app';

export const api = functions.https.onRequest(async (req, res) => {
  const { expressApp } = await NestApp.getInstance(true);
  return expressApp!(req, res);
});
