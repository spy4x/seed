/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { type AttachmentRules, type Entitlements, PlanError, PLANS } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import {
  type Attachment,
  ATTACHMENT_UPLOAD_BUDGET,
  AttachmentConfirmCommand,
  AttachmentDownloadQuery,
  AttachmentError,
  AttachmentListQuery,
  AttachmentRemoveCommand,
  type AttachmentRepository,
  AttachmentSignCommand,
  type AttachmentUploadBudget,
  type PendingAttachmentUpload,
} from "@domain/notes"
import { FileRefusal, type FileStore } from "@server/files/files.ts"
import {
  type AttachmentHandlerDependencies,
  createAttachmentConfirmHandler,
  createAttachmentDownloadHandler,
  createAttachmentListHandler,
  createAttachmentRemoveHandler,
  createAttachmentSignHandler,
} from "./attachments.ts"

const GROUP = `0190a000-0000-7000-8000-000000000001`
const OTHER_GROUP = `0190a000-0000-7000-8000-000000000002`
const NOTE = `0190a000-0000-7000-8000-000000000003`
const EDITOR = 1
const VIEWER = 2
const OTHER_EDITOR = 3
const MB = 1024 * 1024

const FREE = PLANS[0]

/** Attachments in memory: one live note in {@link GROUP}. */
function memoryAttachments() {
  const pending = new Map<string, PendingAttachmentUpload>()
  const stored = new Map<string, Attachment & { objectKey: string; groupId: string }>()
  const forgotten: string[] = []
  const added: string[] = []
  let failAdd: Error | null = null
  const repository: AttachmentRepository = {
    hasLiveNote: (groupId, noteId) => Promise.resolve(groupId === GROUP && noteId === NOTE),
    list: (groupId, noteId) =>
      Promise.resolve(
        [...stored.values()].filter((a) => a.groupId === groupId && a.noteId === noteId),
      ),
    get: (groupId, id) => {
      const row = stored.get(id)
      return Promise.resolve(row && row.groupId === groupId ? row : null)
    },
    usage: () =>
      Promise.resolve({
        files: stored.size,
        bytes: [...stored.values()].reduce((sum, a) => sum + a.size, 0),
      }),
    countForNote: (noteId) =>
      Promise.resolve([...stored.values()].filter((a) => a.noteId === noteId).length),
    releaseUpload: (id, userId) => {
      if (pending.get(id)?.userId === userId) pending.delete(id)
      return Promise.resolve()
    },
    createUpload: (upload) => {
      pending.set(upload.id, upload)
      return Promise.resolve()
    },
    claimUpload: (id, userId) => {
      const upload = pending.get(id)
      if (!upload || upload.userId !== userId) return Promise.resolve(null)
      pending.delete(id)
      return Promise.resolve(upload)
    },
    add: (groupId, upload, objectKey, _caps, actorId) => {
      if (failAdd) return Promise.reject(failAdd)
      const attachment: Attachment = {
        id: upload.id,
        noteId: upload.noteId,
        name: upload.name,
        contentType: upload.contentType,
        size: upload.size,
        createdByUserId: actorId,
        createdAt: new Date(0),
      }
      stored.set(upload.id, { ...attachment, objectKey, groupId })
      added.push(objectKey)
      return Promise.resolve(attachment)
    },
    remove: (groupId, id) => {
      const row = stored.get(id)
      if (!row || row.groupId !== groupId) {
        return Promise.reject(new AttachmentError("ATTACHMENT_NOT_FOUND", "File not found"))
      }
      stored.delete(id)
      return Promise.resolve(row.objectKey)
    },
    forgetDeletion: (key) => {
      forgotten.push(key)
      return Promise.resolve()
    },
  }
  return {
    repository,
    pending,
    stored,
    forgotten,
    added,
    failNextAdd: (error: Error) => (failAdd = error),
  }
}

/** A file store that records its calls; `confirm` says what the stored bytes turn out to be. */
function fakeFiles(confirm: FileRefusal | null = null) {
  const calls: { method: string; args: unknown[] }[] = []
  const record = (method: string, ...args: unknown[]) => calls.push({ method, args })
  let staged = 0
  const files: FileStore = {
    bucket: `files`,
    signUpload(rule, file) {
      record(`signUpload`, rule, file)
      if (!rule.types.includes(file.contentType)) {
        return Promise.resolve({ success: false, error: FileRefusal.Type })
      }
      if (file.size > rule.maxBytes) {
        return Promise.resolve({ success: false, error: FileRefusal.Size })
      }
      const stagingKey = `uploads/tmp/${++staged}`
      return Promise.resolve({
        success: true,
        output: {
          url: `https://app.example.test/${stagingKey}`,
          headers: { "content-type": file.contentType },
          stagingKey,
        },
      })
    },
    confirmUpload(stagingKey, key, signed) {
      record(`confirmUpload`, stagingKey, key, signed)
      return Promise.resolve(
        confirm === null ? { success: true, output: signed } : { success: false, error: confirm },
      )
    },
    signDownload(key, file) {
      record(`signDownload`, key, file)
      return Promise.resolve(`https://app.example.test/get/${key}`)
    },
    delete(key) {
      record(`delete`, key)
      return Promise.resolve()
    },
    read: () => Promise.resolve(null),
    isReachable: () => Promise.resolve(true),
  }
  return { files, calls }
}

function setUp(
  options: {
    confirm?: FileRefusal | null
    limits?: Partial<Entitlements["limits"]>
    rules?: Partial<AttachmentRules>
    budget?: AttachmentUploadBudget
  } = {},
) {
  const memory = memoryAttachments()
  const store = fakeFiles(options.confirm ?? null)
  const roles = new Map([[EDITOR, GroupRole.EDITOR], [VIEWER, GroupRole.VIEWER], [
    OTHER_EDITOR,
    GroupRole.EDITOR,
  ]])
  const dependencies: AttachmentHandlerDependencies = {
    attachments: memory.repository,
    files: store.files,
    groups: {
      roleOf: (groupId, userId) =>
        Promise.resolve(groupId === GROUP ? roles.get(userId) ?? null : null),
    },
    plans: {
      of: () =>
        Promise.resolve({
          limits: { ...FREE.entitlements.limits, ...options.limits },
          rules: { ...FREE.attachments, ...options.rules },
        }),
    },
    budget: options.budget ?? ATTACHMENT_UPLOAD_BUDGET,
  }
  const sign = createAttachmentSignHandler(dependencies)
  const confirm = createAttachmentConfirmHandler(dependencies)
  const actor = (userId: number) => ({ userId, sessionId: `s`, role: 1 }) as never
  const signAs = (
    userId: number,
    file: { name?: string; contentType?: string; size?: number } = {},
  ) =>
    sign(
      new AttachmentSignCommand({
        actor: actor(userId),
        groupId: GROUP,
        noteId: NOTE,
        name: file.name ?? `scan.pdf`,
        contentType: file.contentType ?? `application/pdf`,
        size: file.size ?? 1000,
      }),
    )
  const confirmAs = (userId: number, id: string, groupId = GROUP) =>
    confirm(new AttachmentConfirmCommand({ actor: actor(userId), groupId, id }))
  return { ...memory, ...store, dependencies, actor, signAs, confirmAs }
}

Deno.test("an editor's upload is signed to a staging key and waits for its confirm", async () => {
  const { signAs, pending, calls } = setUp()

  const signed = await signAs(EDITOR)

  expect(signed.url).toBe(`https://app.example.test/uploads/tmp/1`)
  expect(pending.get(signed.id)).toMatchObject({ userId: EDITOR, stagingKey: `uploads/tmp/1` })
  expect(calls[0].args[0]).toMatchObject({ maxBytes: 2 * MB })
})

Deno.test("a viewer and a stranger are refused before anything is signed", async () => {
  const { signAs, calls, actor, dependencies } = setUp()
  await expect(signAs(VIEWER)).rejects.toMatchObject({ code: `ROLE_INSUFFICIENT` })
  const stranger = createAttachmentSignHandler(dependencies)
  await expect(stranger(
    new AttachmentSignCommand({
      actor: actor(EDITOR),
      groupId: OTHER_GROUP,
      noteId: NOTE,
      name: `a.png`,
      contentType: `image/png`,
      size: 10,
    }),
  )).rejects.toMatchObject({ code: `GROUP_NOT_FOUND` })
  expect(calls).toEqual([])
})

Deno.test("each file rule refuses before signing: type, size and a full note", async () => {
  const typed = setUp()
  await expect(typed.signAs(EDITOR, { name: `photo.heic`, contentType: `image/heic` })).rejects
    .toMatchObject({ code: `FILE_TYPE` })
  await expect(typed.signAs(EDITOR, { contentType: `image/svg+xml` })).rejects
    .toMatchObject({ code: `FILE_TYPE` })
  await expect(typed.signAs(EDITOR, { size: 2 * MB + 1 })).rejects
    .toMatchObject({ code: `FILE_TOO_LARGE`, limit: 2 * MB })

  const full = setUp({ rules: { maxPerNote: 1 } })
  await full.confirmAs(EDITOR, (await full.signAs(EDITOR)).id)
  await expect(full.signAs(EDITOR)).rejects.toMatchObject({ code: `NOTE_FULL`, limit: 1 })
})

Deno.test("a group at its plan's file or byte cap is refused with the plan's answer", async () => {
  const files = setUp({ limits: { maxAttachments: 1 } })
  await files.confirmAs(EDITOR, (await files.signAs(EDITOR)).id)
  const refusal = await files.signAs(EDITOR).catch((error) => error)
  expect(refusal).toBeInstanceOf(PlanError)
  expect(refusal).toMatchObject({ entitlement: `maxAttachments`, limit: 1, canUpgrade: false })

  const bytes = setUp({ limits: { storageBytes: 1500 } })
  await bytes.confirmAs(EDITOR, (await bytes.signAs(EDITOR, { size: 1000 })).id)
  await expect(bytes.signAs(EDITOR, { size: 501 })).rejects.toMatchObject({
    entitlement: `storageBytes`,
  })
  await bytes.signAs(EDITOR, { size: 500 })
})

Deno.test("a plan that raises the file size limit lets a larger file in, with no other change", async () => {
  const raised = setUp({ rules: { maxFileBytes: 5 * MB } })
  const signed = await raised.signAs(EDITOR, { size: 3 * MB })
  expect(raised.pending.get(signed.id)?.size).toBe(3 * MB)
})

Deno.test("only the person who signed an upload confirms it, and only once", async () => {
  const { signAs, confirmAs, calls, stored } = setUp()
  const { id } = await signAs(EDITOR)

  await expect(confirmAs(OTHER_EDITOR, id)).rejects.toMatchObject({ code: `UPLOAD_NOT_FOUND` })
  const [first, second] = await Promise.allSettled([confirmAs(EDITOR, id), confirmAs(EDITOR, id)])

  expect(first.status).toBe(`fulfilled`)
  expect(second).toMatchObject({ status: `rejected`, reason: { code: `UPLOAD_NOT_FOUND` } })
  expect(stored.size).toBe(1)
  expect(calls.filter((call) => call.method === `confirmUpload`)).toEqual([{
    method: `confirmUpload`,
    args: [`uploads/tmp/1`, `attachments/${id}`, { contentType: `application/pdf`, size: 1000 }],
  }])
})

Deno.test("a viewer cannot confirm, and the upload stays for its owner", async () => {
  const { signAs, confirmAs, pending } = setUp()
  const { id } = await signAs(EDITOR)
  await expect(confirmAs(VIEWER, id)).rejects.toMatchObject({ code: `ROLE_INSUFFICIENT` })
  expect(pending.has(id)).toBe(true)
})

Deno.test("a file whose bytes are not its type is refused and never added", async () => {
  const { signAs, confirmAs, stored } = setUp({ confirm: FileRefusal.Content })
  const { id } = await signAs(EDITOR, { name: `invoice.pdf` })
  await expect(confirmAs(EDITOR, id)).rejects.toMatchObject({ code: `FILE_CONTENT` })
  expect(stored.size).toBe(0)
})

Deno.test("a confirmed file the group has no room for is deleted from the store", async () => {
  const { signAs, confirmAs, calls, failNextAdd } = setUp()
  const { id } = await signAs(EDITOR)
  failNextAdd(new PlanError(`PLAN_LIMIT_REACHED`, `maxAttachments`, 1, false, `full`))

  await expect(confirmAs(EDITOR, id)).rejects.toBeInstanceOf(PlanError)
  expect(calls.at(-1)).toEqual({ method: `delete`, args: [`attachments/${id}`] })
})

Deno.test("removing a file deletes its object and forgets the queued deletion", async () => {
  const setup = setUp()
  const { id } = await setup.signAs(EDITOR)
  await setup.confirmAs(EDITOR, id)
  const remove = createAttachmentRemoveHandler(setup.dependencies)

  await expect(
    remove(new AttachmentRemoveCommand({ actor: setup.actor(VIEWER), groupId: GROUP, id })),
  )
    .rejects.toMatchObject({ code: `ROLE_INSUFFICIENT` })
  await remove(new AttachmentRemoveCommand({ actor: setup.actor(EDITOR), groupId: GROUP, id }))

  expect(setup.calls.at(-1)).toEqual({ method: `delete`, args: [`attachments/${id}`] })
  expect(setup.forgotten).toEqual([`attachments/${id}`])
})

Deno.test("a download is signed for a member of the file's group only, with its confirmed type", async () => {
  const setup = setUp()
  const { id } = await setup.signAs(EDITOR, { name: `scan.pdf` })
  await setup.confirmAs(EDITOR, id)
  const download = createAttachmentDownloadHandler(setup.dependencies)

  const { url } = await download(
    new AttachmentDownloadQuery({ actor: setup.actor(VIEWER), groupId: GROUP, id }),
  )
  expect(url).toBe(`https://app.example.test/get/attachments/${id}`)
  expect(setup.calls.at(-1)?.args[1]).toEqual({
    contentType: `application/pdf`,
    filename: `scan.pdf`,
  })
  await expect(download(
    new AttachmentDownloadQuery({ actor: setup.actor(VIEWER), groupId: OTHER_GROUP, id }),
  )).rejects.toMatchObject({ code: `GROUP_NOT_FOUND` })
})

Deno.test("the list gives a member the note's files and the group's room under its plan", async () => {
  const setup = setUp()
  await setup.confirmAs(EDITOR, (await setup.signAs(EDITOR, { size: 700 })).id)
  const list = createAttachmentListHandler(setup.dependencies)

  const result = await list(
    new AttachmentListQuery({ actor: setup.actor(VIEWER), groupId: GROUP, noteId: NOTE }),
  )

  expect(result.attachments.map((a) => a.size)).toEqual([700])
  expect(result.usage).toEqual({
    files: 1,
    bytes: 700,
    maxFiles: 100,
    maxBytes: 200 * MB,
    maxFileBytes: 2 * MB,
    maxPerNote: 10,
  })
})
