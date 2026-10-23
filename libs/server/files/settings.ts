import type { FileStoreSettings } from "./files.ts"

/** The variables the worker reads to reach the file store; the API reads the same ones. */
export const SERVER_FILES_KEYS = [
  `S3_ENDPOINT`,
  `S3_REGION`,
  `S3_BUCKET`,
  `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`,
] as const

/** The file store's settings for a process that only writes and deletes, or what is missing. */
export type ServerFilesSetup =
  | { success: true; output: Omit<FileStoreSettings, `publicEndpoint`>; error?: undefined }
  | { success: false; output?: undefined; error: string }

/**
 * Reads the worker's file store settings (docs/files.md). A process without them builds no data
 * export, so the result names every missing variable for its start-up warning.
 */
export function readServerFilesSetup(
  env: { get(name: string): string | undefined },
): ServerFilesSetup {
  const missing = SERVER_FILES_KEYS.filter((key) => !env.get(key)?.trim())
  if (missing.length > 0) {
    return {
      success: false,
      error: `The file store is not set up (${missing.join(`, `)}): data exports wait`,
    }
  }
  const value = (key: (typeof SERVER_FILES_KEYS)[number]) => env.get(key)!.trim()
  return {
    success: true,
    output: {
      endpoint: value(`S3_ENDPOINT`),
      region: value(`S3_REGION`),
      bucket: value(`S3_BUCKET`),
      accessKeyId: value(`S3_ACCESS_KEY_ID`),
      secretAccessKey: value(`S3_SECRET_ACCESS_KEY`),
    },
  }
}
