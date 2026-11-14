import { FILES_OFF_STORE, type FileStore, s3FileStore } from "@server/files/files.ts"
import { config } from "./config.ts"

/**
 * The file store every feature keeps its files in (docs/files.md). With `FILES=false` it is
 * `FILES_OFF_STORE`, which refuses every call and reaches no store.
 */
export const files: FileStore = config.files ? s3FileStore(config.files) : FILES_OFF_STORE
