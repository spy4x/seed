import { API_CONFIG, LogService } from '@seed/back/api/shared';
import { getApp } from '@seed/back/api/core';

void new LogService('Start API').trackSegment('Nest', async logSegment => {
  const DEFAULT_PORT = 8080;
  const DEFAULT_HOST = '0.0.0.0';
  const host = process.env.host || DEFAULT_HOST;
  const port = process.env.port || DEFAULT_PORT;
  const { nest } = await getApp();
  await nest.listen(port);
  logSegment.log(`Listening at http://${host}:${port}/${API_CONFIG.apiPrefix}`);
});
