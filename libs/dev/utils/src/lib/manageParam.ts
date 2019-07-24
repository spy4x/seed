export const checkParam = (name: string, value: string | undefined): void => {
  if (!value) {
    throw new Error(`Parameter "${name}" is not specified`);
  }
};

export const ensureParam = (name: string, value: string | undefined): string => {
  checkParam(name, value);

  return value as string;
};
