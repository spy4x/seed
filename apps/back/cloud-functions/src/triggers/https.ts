import * as functions from 'firebase-functions';
import { getApp } from '@seed/back/functions/core';
import { API_CONFIG } from '@seed/back/functions/shared';

export const api = functions.https.onRequest(async (req, res) => {
  const { express } = await getApp();
  return express(req, res);
});

async function initLocalDevelopment(): Promise<void> {
  const port = process.env.port || 3333;
  const { nest } = await getApp();
  await nest.listen(port, () => {
    console.log('Listening at http://localhost:' + port + '/' + API_CONFIG.apiPrefix);
  });
}

if (process.env.NODE_ENV !== 'production') {
  // TODO: check if not Firebase Emulator
  initLocalDevelopment();
}
