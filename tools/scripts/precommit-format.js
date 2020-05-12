const { execSync } = require('child_process');

const formatAndStage = () => {
  /**
   * returns list of staged files (regex mask "*")
   */
  const command = `git diff --cached --name-only --diff-filter=ACM "*" | sed 's| |\\ |g'`;
  const result = execSync(command).toString();
  const supportedFileExtensions = ['ts', 'js', 'css', 'scss', 'pug', 'html', 'json'];
  const files = result
    .split('\n')
    .filter(file => !!file && supportedFileExtensions.some(ext => file.endsWith('.' + ext)));

  if (!files.length) {
    console.log('No changed files');
    return;
  }

  execSync(`yarn prettier --write ${files.join(' ')}`);
  execSync(`git add ${files.join(' ')}`);
};

formatAndStage();
