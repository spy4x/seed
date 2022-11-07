import { dirname, join } from 'path';
import { copyFileSync, existsSync, lstatSync, readdirSync } from 'fs';

const exampleFileName = '.env_example';
const envFileName = '.env';
let wasCreated = false;

function createEnvs(startPath = `.`, level = 0) {
  if (level >= 10) {
    // max depth
    return;
  }

  if (!existsSync(startPath)) {
    console.error('No such directory:', startPath);
    return;
  }

  const files = readdirSync(startPath);
  for (let i = 0; i < files.length; i++) {
    const filename = join(startPath, files[i]);
    const stat = lstatSync(filename);
    if (stat.isDirectory()) {
      createEnvs(filename); // recursive
    } else if (filename.endsWith(exampleFileName)) {
      const parentPath = dirname(filename);
      const envPath = join(parentPath, envFileName);
      if (!existsSync(envPath)) {
        console.log(`📝Creating env file "${envPath}"`);
        copyFileSync(filename, envPath);
        wasCreated = true;
      }
    }
  }
}

createEnvs();

if (wasCreated) {
  console.log('✅ Env files created');
}
