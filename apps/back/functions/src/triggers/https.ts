import * as functions from 'firebase-functions';
import { NestApp } from '@seed/back/functions/core';

export const api = functions.https.onRequest(async (req, res) => {
  const { expressApp } = await NestApp.getInstance(true);
  return expressApp!(req, res);
});

async function initLocalDevelopment(): Promise<void> {
  const port = process.env.port || 3333;
  const { nestApp } = await NestApp.getInstance(true);
  await nestApp.listen(port, () => {
    console.log('Listening at http://localhost:' + port + '/' + NestApp.apiPrefix);
  });
}

if (process.env.NODE_ENV !== 'production') {
  // TODO: check if not Firebase Emulator
  initLocalDevelopment();
}
