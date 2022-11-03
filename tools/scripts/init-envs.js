const glob = require('glob');
const path = require('path');
const fs = require('fs');

glob('./{apps,envs}/**/.env_example', function (err, files) {
  if (err) {
    console.error(err);
  }
  if (!files.length) {
    return;
  }

  let wasCreated = false;

  files.forEach(file => {
    const parentPath = path.dirname(file);
    const envDevPath = path.join(parentPath, '.env.dev');
    if (!fs.existsSync(envDevPath)) {
      console.log(`📝Creating env file "${envDevPath}"`);
      fs.copyFileSync(file, envDevPath);
      wasCreated = true;
    }
  });

  if (wasCreated) {
    console.log('✅ Env files created');
  }
});
