const { execSync } = require('child_process');
const chalk = require('chalk');

const exec = command => {
  console.log(chalk.cyan(`\n$ ${command}`));
  const result = execSync(command).toString();
  console.log(result);
  return result;
};

const formatAndStage = () => {
  /**
   * returns list of staged files (regex mask "*")
   */
  const command = `git diff --cached --name-only --diff-filter=ACM "*" | sed 's| |\\ |g'`;
  const result = exec(command);
  const files = result.split('\n').filter(file => !!file);

  if (!files.length) {
    console.log('No changed files');
    return;
  }

  exec(`yarn format`);
  exec(`git add ${files.join(' ')}`);
};

formatAndStage();
