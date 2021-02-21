const packageJson = require('../../package.json');
// fs is for reading and writing files
const fs = require('fs');
// Refers to package.json
const deps = packageJson['cloud-functions-dependencies'];
// Template of new package.json
const newPackageJson = {
  engines: { node: '10' },
  main: 'main.js',
  dependencies: deps.reduce((acc, cur) => {
    acc[cur] = packageJson.dependencies[cur];
    return acc;
  }, {}),
};

// console.log(JSON.stringify(newPackageJson, null, 2)); // Uncomment for debug purposes only
let path = 'dist/apps/back/cloud-functions/package.json';

fs.writeFileSync(path, JSON.stringify(newPackageJson));
console.log(`${path} written successfully.`);
