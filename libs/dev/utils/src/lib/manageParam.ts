export const checkParam = (name: string, value: string | undefined | null): void => {
  if (!value) {
    throw new Error(`Parameter "${name}" is not specified`);
  }
};

export const ensureParam = (name: string, value: string | undefined | null): string => {
  checkParam(name, value);

  return value as string;
};
