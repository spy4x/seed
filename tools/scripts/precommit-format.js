const { execSync } = require('child_process');
const { green } = require('chalk');

const formatAndStage = () => {
  /**
   * returns list of staged files (regex mask "*")
   */
  const command = `git diff --name-only --staged --diff-filter=AM`;
  const result = execSync(command).toString();
  const supportedFileExtensions = ['ts', 'js', 'css', 'scss', 'html', 'json', 'yaml'];
  const files = result
    .split('\n')
    .filter(file => !!file && supportedFileExtensions.some(ext => file.endsWith('.' + ext)));
  if (!files.length) {
    console.log('No changed files');
    return;
  }

  execSync(`yarn prettier --write ${files.join(' ')}`);
  execSync(`yarn ci:format`);
  execSync(`git add ${files.join(' ')}`);
  console.log(green('✅ All files were formatted'));
};

formatAndStage();
