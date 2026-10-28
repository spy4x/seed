import type { PictureHandlerDependencies } from "../features/profile/picture.ts"
import { config } from "../services/config.ts"
import { db } from "../services/db.ts"
import { eventBus } from "../services/eventBus.ts"
import { files } from "../services/files.ts"
import { createPictureStore } from "./picture-store.ts"

/**
 * What the profile picture handlers run on: the picture store (`picture-store.ts`), the file store
 * and the hourly budget note attachments spend too.
 */
export const pictureDependencies: PictureHandlerDependencies = {
  files,
  budget: config.attachmentUploadBudget,
  emit: (event) => eventBus.emit(event),
  pictures: createPictureStore(db),
}
