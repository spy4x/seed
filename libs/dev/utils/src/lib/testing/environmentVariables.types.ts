/**
 * Environment variable for Testing
 */
export interface TestingEnvironmentVariable {
  /**
   * how it is in "process.env"
   */
  title: string;
  /**
   * value of the variable
   */
  value: string;
}

/**
 * Environment variables Map for Testing
 */
export interface TestingEnvironmentVariables {
  [key: string]: TestingEnvironmentVariable;
}
