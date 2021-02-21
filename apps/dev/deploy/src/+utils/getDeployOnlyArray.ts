export const getDeployOnlyArray = (affectedApps: string[]): string[] => {
  const map: { [key: string]: string } = {
    'front-admin': 'hosting:front-admin',
    'front-client': 'hosting:front-client',
    'back-cloud-functions': 'functions',
  };
  const initialValue: string[] = [];

  return affectedApps.reduce((result: string[], appName: string) => {
    const deployItem = map[appName];

    return deployItem ? [...result, deployItem] : result;
  }, initialValue);
};
