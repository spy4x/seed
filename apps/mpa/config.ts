/** What the MPA needs to know about its surroundings. */
export interface MpaConfig {
  /** Where the MPA reaches the API from the server, such as `http://api:8000`. Never a browser URL. */
  apiUrl: string
  /**
   * The origin the browser sees the MPA at, such as `https://www.example.com`, from `MPA_DOMAIN`.
   * The MPA refuses a post from any other origin.
   */
  webAppOrigin: string
  /**
   * The origin the API accepts posts from, such as `https://app.example.com`: the value the API
   * derives from `ENV` and `DOMAIN`, where the SPA is served.
   */
  apiOrigin: string
}

/**
 * Reads the configuration from the environment: `ENV`, `DOMAIN` (as the API reads them), `API_URL`
 * and `MPA_DOMAIN`. Throws when a required one is missing, or when `MPA_DOMAIN` carries a scheme
 * (it would become the host `https`), so a misconfigured MPA refuses to start.
 */
export function readMpaConfig(env: { get(name: string): string | undefined }): MpaConfig {
  const required = (name: string): string => {
    const value = env.get(name)
    if (!value) throw new Error(`${name} is required: the MPA cannot start without it`)
    return value
  }
  const scheme = required("ENV") === "dev" ? "http" : "https"
  if (required("MPA_DOMAIN").includes("://")) {
    throw new Error("MPA_DOMAIN must be a host such as www.example.com, without a scheme")
  }
  const apiOrigin = new URL(`${scheme}://${required("DOMAIN")}`).origin
  return {
    apiUrl: new URL(required("API_URL")).origin,
    webAppOrigin: new URL(`${scheme}://${required("MPA_DOMAIN")}`).origin,
    apiOrigin,
  }
}
