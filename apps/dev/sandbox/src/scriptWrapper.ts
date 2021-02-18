import { NestApp } from '@seed/back/functions/core';
import { INestApplication } from '@nestjs/common/interfaces';

export async function scriptWrapper(fn: (nestApp: INestApplication) => Promise<void>) {
  const start = new Date();
  try {
    console.log(`▶️  Starting "${fn.name}" at ${start.toISOString()}`);
    const { nestApp } = await NestApp.getInstance(false);
    await fn(nestApp);
    const finish = new Date();
    console.log(
      `✅ Done with "${fn.name}" at ${finish.toISOString()}. Duration: ${finish.getTime() - start.getTime()}ms`,
    );
  } catch (error) {
    const finish = new Date();
    console.error(
      `⛔️ ${fn.name} failed at ${finish.toISOString()}. Duration: ${finish.getTime() - start.getTime()}ms`,
      error,
    );
  }
}
