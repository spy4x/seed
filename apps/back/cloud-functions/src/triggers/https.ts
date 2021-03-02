import * as functions from 'firebase-functions';
import { getApp } from '@seed/back/api/core';
import { API_CONFIG, Environment, isEnv, LogService } from '@seed/back/api/shared';

export const api = functions.https.onRequest(async (req, res) => {
  const { express } = await getApp();
  await express(req, res);
});

async function initLocalDevelopment(): Promise<void> {
  return new LogService(initLocalDevelopment.name).trackSegment('Nest', async logSegment => {
    const DEFAULT_PORT = 3333;
    const port = process.env.port || DEFAULT_PORT;
    const { nest } = await getApp();
    await nest.listen(port);
    logSegment.log(`Listening at http://localhost:${port}/${API_CONFIG.apiPrefix}`);
  });
}

if (!isEnv(Environment.production)) {
  // TODO: check if not Firebase Emulator
  void initLocalDevelopment();
}
