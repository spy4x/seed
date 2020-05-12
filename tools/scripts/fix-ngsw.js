// Fix for https://github.com/angular/angular/issues/23244

const fs = require('fs');
const appName = process.argv[2];

if (!appName) {
  throw new Error(`
Please provide app name from "/apps/front" folder.
Examples of usage:

# for admin app, using node:
$ node tools/scripts/fix-ngsw.js admin

# for admin app, using yarn and package.json script "fix-ngsw":
$ yarn fix-ngsw admin
`);
}

const filePath = `./dist/apps/front/${appName}/ngsw-worker.js`;
const from = `onFetch(event) {`;
const to = `onFetch(event) {
        const isGoogleApis = event.request.url.indexOf('googleapis') !== -1;
        if (isGoogleApis) { return; }`;

try {
  const newContents = fs
    .readFileSync(filePath)
    .toString()
    .replace(from, to);
  fs.writeFileSync(filePath, newContents);
  console.log(`${filePath} fixed`);
} catch (error) {
  console.error('Error occurred during fix of ${filePath}\n', error);
}
