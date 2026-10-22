import { s3FileStore } from "@server/files/files.ts"
import { config } from "./config.ts"

/** The file store every feature keeps its files in (docs/files.md). */
export const files = s3FileStore(config.files)
