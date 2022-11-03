const glob = require('glob');
const path = require('path');
const fs = require('fs');

const exampleFileName = '.env_example';
const envFileName = '.env';
glob(`{apps/**/${exampleFileName},${exampleFileName}}`, function (err, files) {
  if (err) {
    console.error(err);
  }
  if (!files.length) {
    return;
  }

  let wasCreated = false;

  files.forEach(file => {
    const parentPath = path.dirname(file);
    const envPath = path.join(parentPath, envFileName);
    if (!fs.existsSync(envPath)) {
      console.log(`📝Creating env file "${envPath}"`);
      fs.copyFileSync(file, envPath);
      wasCreated = true;
    }
  });

  if (wasCreated) {
    console.log('✅ Env files created');
  }
});
