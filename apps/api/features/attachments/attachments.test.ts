/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { type AttachmentRules, type Entitlements, PlanError } from "@domain/billing"
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
} from "@domain/attachments"
import { assertCanReadNotes, assertCanWriteNotes, NoteError } from "@domain/notes"
import { FileRefusal, FILES_OFF_STORE, FilesOffError, type FileStore } from "@server/files/files.ts"
import {
  type AttachmentHandlerDependencies,
  createAttachmentConfirmHandler,
  createAttachmentDownloadHandler,
  createAttachmentListHandler,
  createAttachmentOperations,
  createAttachmentRemoveHandler,
  createAttachmentSignHandler,
} from "./attachments.ts"
import { attachmentKinds } from "@server/attachments/registry.ts"
import { NOTES_OFF, NOTES_ON } from "@server/notes/setup.ts"
import { TEST_FREE_PLAN } from "../../../../libs/domain/billing/test-plans.ts"

const GROUP = `0190a000-0000-7000-8000-000000000001`
const OTHER_GROUP = `0190a000-0000-7000-8000-000000000002`
const NOTE = `0190a000-0000-7000-8000-000000000003`
const TASK = `0190a000-0000-7000-8000-000000000004`
const EDITOR = 1
const VIEWER = 2
const OTHER_EDITOR = 3
const MB = 1024 * 1024

const FREE = TEST_FREE_PLAN

/** The notes' rules, as `libs/server/notes/attachment-kind.ts` registers them. */
const NOTE_KIND = {
  name: `note`,
  assertCanRead: assertCanReadNotes,
  assertCanWrite: assertCanWriteNotes,
  recordNotFound: () => new NoteError(`NOTE_NOT_FOUND`, `Note not found`),
}
/** A second kind, the way a product would add one: its own record and its own error. */
const TASK_KIND = {
  name: `task`,
  assertCanRead: assertCanReadNotes,
  assertCanWrite: assertCanWriteNotes,
  recordNotFound: () => new Error(`TASK_NOT_FOUND`),
}

type StoredFile = Attachment & { objectKey: string; groupId: string; kind: string }
type WaitingUpload = PendingAttachmentUpload & { kind: string }

/**
 * One kind's attachments in memory, with one live record in {@link GROUP}. Kinds made from the
 * same `pending` and `stored` share them, as they share `file_uploads` and the group's usage.
 */
function memoryAttachments(
  kind: string,
  record: string,
  pending = new Map<string, WaitingUpload>(),
  stored = new Map<string, StoredFile>(),
) {
  const forgotten: string[] = []
  const added: string[] = []
  let failAdd: Error | null = null
  const own = () => [...stored.values()].filter((a) => a.kind === kind)
  const repository: AttachmentRepository = {
    hasLiveRecord: (groupId, recordId) => Promise.resolve(groupId === GROUP && recordId === record),
    list: (groupId, recordId) =>
      Promise.resolve(own().filter((a) => a.groupId === groupId && a.recordId === recordId)),
    get: (groupId, id) => {
      const row = own().find((a) => a.id === id)
      return Promise.resolve(row && row.groupId === groupId ? row : null)
    },
    usage: () =>
      Promise.resolve({
        files: stored.size,
        bytes: [...stored.values()].reduce((sum, a) => sum + a.size, 0),
      }),
    countForRecord: (recordId) =>
      Promise.resolve(own().filter((a) => a.recordId === recordId).length),
    releaseUpload: (id, userId) => {
      const upload = pending.get(id)
      if (upload?.userId === userId && upload.kind === kind) pending.delete(id)
      return Promise.resolve()
    },
    createUpload: (upload) => {
      pending.set(upload.id, { ...upload, kind })
      return Promise.resolve()
    },
    claimUpload: (id, userId) => {
      const upload = pending.get(id)
      if (!upload || upload.userId !== userId || upload.kind !== kind) return Promise.resolve(null)
      pending.delete(id)
      return Promise.resolve(upload)
    },
    add: (groupId, upload, objectKey, _caps, actorId) => {
      if (failAdd) return Promise.reject(failAdd)
      if (groupId !== GROUP || upload.recordId !== record) {
        return Promise.reject(new Error(`the record is not live`))
      }
      const attachment: Attachment = {
        id: upload.id,
        recordId: upload.recordId,
        name: upload.name,
        contentType: upload.contentType,
        size: upload.size,
        createdByUserId: actorId,
        createdAt: new Date(0),
      }
      stored.set(upload.id, { ...attachment, objectKey, groupId, kind })
      added.push(objectKey)
      return Promise.resolve(attachment)
    },
    remove: (groupId, id) => {
      const row = stored.get(id)
      if (!row || row.groupId !== groupId || row.kind !== kind) {
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
    /** Files are off (`FILES=false`): the handlers get `FILES_OFF_STORE`. */
    filesOff?: boolean
  } = {},
) {
  const memory = memoryAttachments(NOTE_KIND.name, NOTE)
  const tasks = memoryAttachments(TASK_KIND.name, TASK, memory.pending, memory.stored)
  const store = fakeFiles(options.confirm ?? null)
  if (options.filesOff) store.files = FILES_OFF_STORE
  const roles = new Map([[EDITOR, GroupRole.EDITOR], [VIEWER, GroupRole.VIEWER], [
    OTHER_EDITOR,
    GroupRole.EDITOR,
  ]])
  const dependencies: AttachmentHandlerDependencies = {
    kinds: [NOTE_KIND, TASK_KIND],
    attachments: (kind) => kind === TASK_KIND.name ? tasks.repository : memory.repository,
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
    kind = NOTE_KIND.name,
    recordId = kind === TASK_KIND.name ? TASK : NOTE,
  ) =>
    sign(
      new AttachmentSignCommand({
        kind,
        actor: actor(userId),
        groupId: GROUP,
        recordId,
        name: file.name ?? `scan.pdf`,
        contentType: file.contentType ?? `application/pdf`,
        size: file.size ?? 1000,
      }),
    )
  const confirmAs = (userId: number, id: string, groupId = GROUP, kind = NOTE_KIND.name) =>
    confirm(new AttachmentConfirmCommand({ kind, actor: actor(userId), groupId, id }))
  return { ...memory, ...store, tasks, dependencies, actor, signAs, confirmAs }
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
      kind: NOTE_KIND.name,
      actor: actor(EDITOR),
      groupId: OTHER_GROUP,
      recordId: NOTE,
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

  const full = setUp({ rules: { maxPerRecord: 1 } })
  await full.confirmAs(EDITOR, (await full.signAs(EDITOR)).id)
  await expect(full.signAs(EDITOR)).rejects.toMatchObject({ code: `RECORD_FULL`, limit: 1 })
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
    remove(
      new AttachmentRemoveCommand({ kind: `note`, actor: setup.actor(VIEWER), groupId: GROUP, id }),
    ),
  )
    .rejects.toMatchObject({ code: `ROLE_INSUFFICIENT` })
  await remove(
    new AttachmentRemoveCommand({ kind: `note`, actor: setup.actor(EDITOR), groupId: GROUP, id }),
  )

  expect(setup.calls.at(-1)).toEqual({ method: `delete`, args: [`attachments/${id}`] })
  expect(setup.forgotten).toEqual([`attachments/${id}`])
})

Deno.test("a download is signed for a member of the file's group only, with its confirmed type", async () => {
  const setup = setUp()
  const { id } = await setup.signAs(EDITOR, { name: `scan.pdf` })
  await setup.confirmAs(EDITOR, id)
  const download = createAttachmentDownloadHandler(setup.dependencies)

  const { url } = await download(
    new AttachmentDownloadQuery({ kind: `note`, actor: setup.actor(VIEWER), groupId: GROUP, id }),
  )
  expect(url).toBe(`https://app.example.test/get/attachments/${id}`)
  expect(setup.calls.at(-1)?.args[1]).toEqual({
    contentType: `application/pdf`,
    filename: `scan.pdf`,
  })
  await expect(download(
    new AttachmentDownloadQuery({
      kind: `note`,
      actor: setup.actor(VIEWER),
      groupId: OTHER_GROUP,
      id,
    }),
  )).rejects.toMatchObject({ code: `GROUP_NOT_FOUND` })
})

Deno.test("with files off, an upload is refused with FilesOffError and nothing waits for a confirm", async () => {
  const { signAs, pending } = setUp({ filesOff: true })

  await expect(signAs(EDITOR)).rejects.toBeInstanceOf(FilesOffError)
  expect(pending.size).toBe(0)
})

Deno.test("the list gives a member the note's files and the group's room under its plan", async () => {
  const setup = setUp()
  await setup.confirmAs(EDITOR, (await setup.signAs(EDITOR, { size: 700 })).id)
  const list = createAttachmentListHandler(setup.dependencies)

  const result = await list(
    new AttachmentListQuery({
      kind: `note`,
      actor: setup.actor(VIEWER),
      groupId: GROUP,
      recordId: NOTE,
    }),
  )

  expect(result.attachments.map((a) => a.size)).toEqual([700])
  expect(result.usage).toEqual({
    files: 1,
    bytes: 700,
    maxFiles: 100,
    maxBytes: 200 * MB,
    maxFileBytes: 2 * MB,
    maxPerRecord: 10,
  })
})

Deno.test("an upload signed for one kind cannot be confirmed through another", async () => {
  const { signAs, confirmAs, pending, stored } = setUp()
  const { id } = await signAs(EDITOR)

  await expect(confirmAs(EDITOR, id, GROUP, TASK_KIND.name)).rejects.toMatchObject({
    code: `UPLOAD_NOT_FOUND`,
  })
  expect(pending.has(id)).toBe(true)
  await confirmAs(EDITOR, id)
  expect(stored.get(id)?.kind).toBe(NOTE_KIND.name)
})

Deno.test("a file of one kind cannot be removed or downloaded through another", async () => {
  const setup = setUp()
  const { id } = await setup.signAs(EDITOR)
  await setup.confirmAs(EDITOR, id)
  const actor = setup.actor(EDITOR)

  await expect(
    createAttachmentRemoveHandler(setup.dependencies)(
      new AttachmentRemoveCommand({ kind: TASK_KIND.name, actor, groupId: GROUP, id }),
    ),
  ).rejects.toMatchObject({ code: `ATTACHMENT_NOT_FOUND` })
  await expect(
    createAttachmentDownloadHandler(setup.dependencies)(
      new AttachmentDownloadQuery({ kind: TASK_KIND.name, actor, groupId: GROUP, id }),
    ),
  ).rejects.toMatchObject({ code: `ATTACHMENT_NOT_FOUND` })
  expect(setup.stored.has(id)).toBe(true)
})

Deno.test("the group's file and byte caps count the files of every kind together", async () => {
  const files = setUp({ limits: { maxAttachments: 1 } })
  await files.confirmAs(EDITOR, (await files.signAs(EDITOR)).id)
  await expect(files.signAs(EDITOR, {}, TASK_KIND.name)).rejects.toMatchObject({
    entitlement: `maxAttachments`,
  })

  const bytes = setUp({ limits: { storageBytes: 1500 } })
  await bytes.confirmAs(EDITOR, (await bytes.signAs(EDITOR, {}, TASK_KIND.name)).id, GROUP, `task`)
  await expect(bytes.signAs(EDITOR, { size: 501 })).rejects.toMatchObject({
    entitlement: `storageBytes`,
  })
})

Deno.test("the per-record cap counts one record's files, not another kind's", async () => {
  const setup = setUp({ rules: { maxPerRecord: 1 } })
  await setup.confirmAs(EDITOR, (await setup.signAs(EDITOR)).id)

  const signed = await setup.signAs(EDITOR, {}, TASK_KIND.name)
  expect(setup.pending.get(signed.id)).toMatchObject({ kind: TASK_KIND.name, recordId: TASK })
})

Deno.test("a record that is not live answers with its own kind's error", async () => {
  const { signAs } = setUp()
  await expect(signAs(EDITOR, {}, TASK_KIND.name, NOTE)).rejects.toThrow(`TASK_NOT_FOUND`)
  await expect(signAs(EDITOR, {}, NOTE_KIND.name, TASK)).rejects.toMatchObject({
    code: `NOTE_NOT_FOUND`,
  })
})

Deno.test("a kind the API does not serve is refused before anything is signed", async () => {
  const { signAs, calls } = setUp()
  await expect(signAs(EDITOR, {}, `invoice`, NOTE)).rejects.toMatchObject({
    code: `INVALID_REQUEST`,
  })
  expect(calls).toEqual([])
})

/** A second kind's operations, as a product would register them. */
const TASK_OPERATIONS = { name: `task`, prefix: `taskFile`, recordField: `taskId` }

/** Operations whose buses record the commands they get. */
function recordingOperations(kinds: Parameters<typeof createAttachmentOperations>[0]) {
  const sent: { kind: string; recordId?: string }[] = []
  const take = (command: { data: { kind: string; recordId?: string } }) => {
    sent.push({ kind: command.data.kind, recordId: command.data.recordId })
    return Promise.resolve(null as never)
  }
  const operations = createAttachmentOperations(kinds, {
    sign: take,
    confirm: take,
    cancel: take,
    remove: take,
    list: take,
    download: take,
  })
  const run = (name: string, payload: unknown) =>
    operations[name].handle({ actor: { userId: EDITOR }, payload } as never)
  return { operations, sent, run }
}

Deno.test("with the notes off, attachment operations are unknown and another kind's stay", () => {
  const on = Object.keys(recordingOperations(attachmentKinds(NOTES_ON)).operations)
  expect(on).toEqual([
    `attachment.sign`,
    `attachment.confirm`,
    `attachment.cancel`,
    `attachment.remove`,
    `attachment.list`,
    `attachment.download`,
  ])
  const off = recordingOperations([...attachmentKinds(NOTES_OFF), TASK_OPERATIONS])
  expect(Object.keys(off.operations).sort()).toEqual([
    `taskFile.cancel`,
    `taskFile.confirm`,
    `taskFile.download`,
    `taskFile.list`,
    `taskFile.remove`,
    `taskFile.sign`,
  ])
})

Deno.test("an operation names its kind from its registration, and a payload naming one is refused", async () => {
  const { run, sent } = recordingOperations([...attachmentKinds(NOTES_ON), TASK_OPERATIONS])
  const file = { groupId: GROUP, name: `scan.pdf`, contentType: `application/pdf`, size: 10 }

  await run(`attachment.sign`, { ...file, noteId: NOTE })
  await run(`taskFile.list`, { groupId: GROUP, taskId: TASK })
  expect(sent).toEqual([{ kind: `note`, recordId: NOTE }, { kind: `task`, recordId: TASK }])

  for (
    const payload of [
      { ...file, noteId: NOTE, kind: `task` },
      { ...file, recordId: NOTE },
      { ...file, taskId: NOTE },
    ]
  ) {
    await expect(run(`attachment.sign`, payload)).rejects.toMatchObject({
      code: `INVALID_REQUEST`,
    })
  }
  expect(sent).toHaveLength(2)
})
