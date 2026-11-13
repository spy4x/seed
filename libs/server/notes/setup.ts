/** Whether the notes example is on: its notes, tags and attachments. */
export interface NotesSetup {
  /** Off with `NOTES=false`: no note, tag or attachment route, operation or handler answers. */
  on: boolean
}

/** The notes of a product that keeps them, as Seed and its demo do. */
export const NOTES_ON: NotesSetup = { on: true }

/** The notes of a product that turns them off. */
export const NOTES_OFF: NotesSetup = { on: false }

/**
 * Reads the notes' switch (docs/start-a-product.md): `NOTES=false` turns the notes example off,
 * and anything else, unset included, keeps it on. The tables stay either way.
 */
export function readNotesSetup(env: { get(name: string): string | undefined }): NotesSetup {
  return env.get(`NOTES`)?.trim() === `false` ? NOTES_OFF : NOTES_ON
}
