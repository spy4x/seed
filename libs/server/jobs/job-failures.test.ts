import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { OutboxAttemptFailure, OutboxEvent } from "@spy4x/server/outbox"
import { cleanupJob, type CleanupStep, logAttemptFailure } from "./job-failures.ts"

const ID = "01900000-0000-7000-8000-000000000001"

/** An outbox row as the processor hands it over, on attempt `attemptCount`. */
function row(attemptCount: number, aggregateType = "job", eventKind = "mail.send"): OutboxEvent {
  return { id: ID, eventKind, aggregateType, aggregateId: ID, aggregateVersion: "1", attemptCount }
}

describe("cleanupJob", () => {
  /** Three steps that note their run; the middle one throws. */
  function steps(ran: string[]): CleanupStep[] {
    return [
      ["first", () => Promise.resolve(void ran.push("first"))],
      ["broken", () => Promise.reject(new Error("relation notes does not exist"))],
      ["last", () => Promise.resolve(void ran.push("last"))],
    ]
  }

  it("runs the steps after one that throws, logs its name and message, then fails the job", async () => {
    const ran: string[] = []
    const logged: string[] = []

    const run = cleanupJob(steps(ran), (line) => logged.push(line))(row(1))

    await expect(run).rejects.toThrow(`nightly cleanup: 1 step(s) failed: "broken"`)
    expect(ran).toEqual(["first", "last"])
    expect(logged).toEqual([
      `error: nightly cleanup step "broken" failed: relation notes does not exist`,
    ])
  })

  it("logs nothing and ends normally when every step succeeds", async () => {
    const logged: string[] = []
    const ran: string[] = []
    const fine = steps(ran).filter(([name]) => name !== "broken")

    await cleanupJob(fine, (line) => logged.push(line))(row(1))

    expect(ran).toEqual(["first", "last"])
    expect(logged).toEqual([])
  })
})

describe("logAttemptFailure", () => {
  /** What the processor reports for attempt `attempt` of 3 of a mail job that threw. */
  function failure(
    attempt: number,
    more: Partial<OutboxAttemptFailure> = {},
  ): OutboxAttemptFailure {
    return {
      event: row(attempt),
      error: new TypeError("no route to ann@example.com"),
      attempt,
      maxAttempts: 3,
      lastAttempt: attempt >= 3,
      stage: "publish",
      ...more,
    }
  }

  it("logs a failed attempt with the row's kind, the stage and the error's name", () => {
    const logged: string[] = []

    logAttemptFailure((line) => logged.push(line))(failure(2))

    expect(logged).toEqual([
      `warn: outbox row mail.send (job ${ID}) failed at publish, attempt 2 of 3: TypeError`,
    ])
  })

  it("logs the last attempt as abandoned, naming the row's kind", () => {
    const logged: string[] = []

    logAttemptFailure((line) => logged.push(line))(failure(3))

    expect(logged).toEqual([
      `error: outbox row mail.send (job ${ID}) abandoned at publish after 3 attempts: TypeError`,
    ])
  })

  it("never logs the error's message, which can quote an address", () => {
    const logged: string[] = []

    logAttemptFailure((line) => logged.push(line))(failure(1))
    logAttemptFailure((line) => logged.push(line))(failure(1, { error: "ann@example.com" }))

    expect(logged.join("\n")).not.toContain("ann@example.com")
    expect(logged[1]).toContain(": string")
  })

  it("names the error an earlier attempt stored when the worker died mid-run", () => {
    const logged: string[] = []

    logAttemptFailure((line) => logged.push(line))(
      failure(3, { stage: "lease", error: new Error("lost"), storedErrorCode: "PostgresError" }),
    )

    expect(logged).toEqual([
      `error: outbox row mail.send (job ${ID}) abandoned at lease after 3 attempts: PostgresError`,
    ])
  })
})
