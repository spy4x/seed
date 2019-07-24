export const getDeployOnlyArray = (affectedApps: string[]): string[] => {
  const map: { [key: string]: string } = {
    admin: 'hosting:admin',
    client: 'hosting:client',
    'firebase-functions': 'functions'
  };
  const initialValue: string[] = [];

  return affectedApps.reduce((result: string[], appName: string) => {
    const deployItem = map[appName];

    return deployItem ? [...result, deployItem] : result;
  }, initialValue);
};
