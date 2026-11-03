# Group Sync Platform PRD

> **Status: superseded in part by [ADR 002](../decisions/002-realtime-transport-and-sync.md).**
>
> Written before ADR 002, so it describes both clients consuming REST. The SPA
> now speaks WebSocket for mutations, queries and realtime, using REST only for
> auth and bootstrap; the MPA remains REST-only. Read every "REST" requirement
> below as "through the shared CQRS handlers", which is what the requirement
> actually meant - the transport split is decided in the ADR.

## 1. Introduction/Overview

This product is a reusable Deno platform template for future web applications that need a REST
API, shared CQRS behavior, secure synchronization, an offline-first SPA, and an SEO-first MPA.
It solves repeated product setup, inconsistent authorization, and unsafe offline replay by giving
new applications one proven baseline in which server state remains authoritative.

Initial scope covers personal data and data shared through groups. One removable notes resource
provides acceptance evidence for create, read, edit, delete, authorization, offline use, conflict,
and synchronization behavior. Notes are not a platform domain commitment and are the only example
resource included.

### Actors

- **Product developer:** starts a future application from the template and replaces example notes
  with product-specific resources.
- **Individual user:** owns personal data, works online or offline, and expects safe recovery after
  reconnecting.
- **Group member:** accesses and changes data in groups permitted by current membership and role.
- **Group administrator:** manages group access and expects revoked access to take effect during
  later synchronization.
- **Public visitor or search crawler:** discovers server-rendered MPA content before any richer app
  interaction.
- **Platform maintainer:** validates reuse, promotes proven generic capabilities, and controls
  distribution stages.

### Scope

- Application lifecycle and distribution baseline on Deno, moving to Deno, Node and Bun.
- REST access with shared CQRS semantics.
- Personal and shared group authorization.
- Server-authoritative synchronization and replay validation.
- Preact and Vite SPA PWA with Dexie and Signals for offline-first use.
- Fresh MPA PWA that consumes the same REST capabilities and prioritizes SEO.
- Git template distribution, followed by proven JSR libraries, then a CLI.

## 2. Goals

1. Deliver a first Git template release in which 100% of defined notes acceptance journeys pass
   online, offline, after reconnect, and across authorized group access.
2. Enable a product developer to start and verify a new application baseline within 60 minutes,
   excluding product-specific work and deployment.
3. Ensure 100% of replayed offline actions receive fresh server-side authentication,
   authorization, and business-rule validation before authoritative state changes.
4. Produce zero duplicate authoritative changes across 100 repeated submissions of each accepted
   notes action and zero unauthorized disclosures across the acceptance security suite.
5. Keep example-domain coupling at zero after the removable notes resource is deleted, as measured
   by successful template verification without that resource.

### Rollout

1. **Stage 1 — Git template:** release complete application baseline and validate it in at least two
   future applications.
2. **Stage 2 — JSR libraries:** publish only generic capabilities used successfully by at least two
   independent applications and unchanged in purpose across two consecutive releases.
3. **Stage 3 — CLI:** release project creation and upgrade assistance only after both flows complete
   successfully for at least three independently created applications.

## 3. User Stories

### Product developer

As a product developer, I want to start from a template built on web standards with clear app
boundaries so I can replace notes with product behavior without rebuilding auth, CQRS, PWA, and
sync foundations.

**Journey:** Create product from Git template, run documented Deno verification, exercise notes
acceptance journeys, remove notes, and confirm generic platform capabilities remain valid.

### Individual user

As an individual user, I want personal notes available offline so I can keep working through a
network interruption and safely synchronize later.

**Journey:** Sign in, create and edit personal notes, lose connectivity, continue working, restart
the SPA, reconnect, and observe only server-accepted changes in final state.

### Group member

As a group member, I want notes from permitted groups synchronized alongside personal notes so I
can collaborate without seeing data from groups I cannot access.

**Journey:** Open a permitted group, work online and offline, reconnect, receive accepted group
changes, and receive clear rejection when membership or role no longer permits an offline action.

### Group administrator

As a group administrator, I want access changes enforced during replay so actions queued before a
revocation cannot bypass current permissions.

**Journey:** Revoke a member while that member is offline, allow reconnection, and verify queued
group changes are rejected and inaccessible local group data is no longer shown.

### Public visitor or search crawler

As a public visitor or search crawler, I want meaningful server-rendered MPA content so public
entry points remain discoverable and useful without depending on SPA execution.

**Journey:** Request a public entry page, receive indexable content, navigate into an interactive
PWA flow, and observe results consistent with the REST-backed product state.

### Platform maintainer

As a platform maintainer, I want staged distribution so reusable capabilities are proven before
they become independently versioned libraries or CLI promises.

**Journey:** Track use across independent applications, verify promotion criteria, and advance only
capabilities that meet the next distribution stage gate.

## 4. Functional Requirements

### Core platform and example acceptance resource

1. The system must provide reusable API, SPA, and MPA product surfaces that use one authoritative
   product state and consistent authorization outcomes.
2. The system must include exactly one removable example resource, notes, solely to prove personal,
   group, online, offline, REST, CQRS, and synchronization behavior.
3. The system must continue to satisfy all generic platform checks after the notes resource is
   removed.
4. The system must let an authenticated user create, read, edit, and delete notes when current
   authorization permits each action.
5. The system must route state-changing behavior through commands and read behavior through queries
   so acceptance tests can distinguish their outcomes.
6. The system must expose notes behavior through REST for authorized SPA and MPA use.

### Identity, groups, and authorization

7. The system must assign each user personal data within a personal group governed by the same
   authorization and synchronization model as shared groups.
8. The system must let authorized users create groups, invite or remove members, and assign the
   access needed for supported notes actions.
9. The system must evaluate current identity, group membership, role, and resource access for every
   online request and every replayed offline action.
10. The system must reject any read or change for a group the current user cannot access without
    disclosing that group's data.
11. The system must apply group access changes to subsequent reads, changes, and synchronization,
    including actions created before access changed but replayed afterward.
12. The system must stop showing locally retained group data after the client learns that current
    access has been revoked.

### Server-authoritative synchronization

13. The system must treat server-accepted state as authoritative and local state as a replaceable
    projection.
14. The system must permit users to read previously synchronized notes and queue supported notes
    actions while the SPA is offline.
15. The system must preserve queued offline actions across SPA reload or restart until each action
    is accepted, rejected, or explicitly discarded by the user.
16. The system must replay queued actions after connectivity returns and report accepted, rejected,
    and conflicting outcomes to the user.
17. The system must revalidate every replayed action against current server-side identity, group
    access, input rules, and authoritative resource state before accepting it.
18. The system must prevent repeated delivery of the same accepted action from applying its
    authoritative change more than once.
19. The system must reject a stale action that conflicts with newer authoritative state and provide
    enough current state for the user to reconcile without silently overwriting accepted work.
20. The system must deliver authorized changes in stable order and let interrupted synchronization
    resume without requiring a complete restart.
21. The system must synchronize personal and shared groups through the same user-visible workflow
    while enforcing policy appropriate to each group and role.
22. The system must converge the SPA projection to authoritative state after all accepted changes
    are received and all rejected changes are resolved or discarded.

### SPA and MPA experiences

23. The system must provide an installable Preact and Vite SPA PWA that uses Dexie for durable local
    projection and Signals for reactive user-visible state.
24. The system must make the SPA application shell and previously synchronized notes usable without
    network access after one successful online load.
25. The system must clearly distinguish pending, accepted, rejected, and conflicting offline
    actions without presenting pending state as server-confirmed state.
26. The system must provide a Fresh MPA PWA whose public entry content is server-rendered and
    indexable without client-side execution.
27. The system must have the MPA consume the same REST-backed product behavior as the SPA rather
    than creating a separate source of product truth.
28. The system must produce consistent authorized notes outcomes when an equivalent supported
    action is performed through either web experience.

### Distribution

29. The system must be distributable as a Git template in the first release.
30. The system must limit later JSR distribution to generic capabilities that meet the Stage 2
    proof criteria.
31. The system must defer CLI distribution until project creation and upgrade behavior meet the
    Stage 3 proof criteria.

### Non-functional and security requirements

32. The product must move to run unchanged on Deno, Node and Bun, with Deno as the toolchain for
    development, verification, build, and operational workflows
    ([runtime policy](../runtime-policy.md), replacing the earlier "Deno only" requirement on
    2026-11-03).
33. Runtime-specific calls must sit behind `@spy4x/platform` adapters, never in application code.
34. The system must allow selected npm packages only where the dependency rules allow them.
35. The system must protect all authenticated network traffic against plaintext transport.
36. The system must treat every client-provided identity, permission claim, state value, and replay
    outcome as untrusted until server validation succeeds.
37. The system must expose zero personal or group note content to an unauthenticated user or a user
    lacking current group access across the acceptance security suite.
38. The system must expose no locally retained content from a previous account after sign-out or an
    account switch.
39. The system must recover from interruption at every tested synchronization boundary without
    losing an accepted action or applying one twice.
40. The system must complete synchronization of 100 server changes plus 20 queued client actions
    within 5 seconds at the 95th percentile under the agreed acceptance environment.
41. The system must meet WCAG 2.2 AA criteria for the notes acceptance journeys in both web
    experiences.
42. The system must retain enough user-visible status to explain whether each offline action is
    pending, accepted, rejected, conflicting, or discarded.

## 5. Non-Goals

1. Product-specific business domains beyond removable notes acceptance behavior.
2. Automatic conflict merging or client authority over server-accepted state.
3. Real-time collaboration, live cursors, presence, chat, or mandatory persistent connections.
4. Native mobile or desktop applications.
5. Full offline feature parity for the MPA; offline-first editing belongs to the SPA.
6. Public JSR libraries during the initial Git template stage.
7. CLI generation or automated upgrades before Stage 3 proof criteria are met.
8. Support for runtimes or task runners other than Deno.
9. A universal group administration product beyond access needed to validate notes behavior.
10. A permanent notes product, sample catalog, or multiple example resources.

## 6. Success Metrics

| Outcome                                                            |                      Target | Measurement window                |
| ------------------------------------------------------------------ | --------------------------: | --------------------------------- |
| Defined notes acceptance journeys passing                          |                        100% | Before first Git template release |
| New application baseline start and verification time               |          60 minutes or less | First two independent adoptions   |
| Unauthorized note disclosures in security suite                    |                           0 | Every release                     |
| Replayed actions receiving fresh server validation                 |                        100% | Every release                     |
| Duplicate authoritative changes across repeated-action tests       | 0 of 100 retries per action | Every release                     |
| Accepted actions lost across interruption tests                    |            0 of 100 actions | Every release                     |
| Projection convergence after accepted sync                         |    100% of 20 repeated runs | Every release                     |
| Sync duration for 100 server changes and 20 queued actions         |    5 seconds or less at p95 | Before first Git template release |
| Public MPA acceptance pages indexable without client execution     |                        100% | Every release                     |
| Notes journeys meeting WCAG 2.2 AA                                 |                        100% | Before first Git template release |
| Disallowed runtime or task-runner commands                         |                           0 | Every release                     |
| Successful independent applications before JSR promotion           |                  At least 2 | Before Stage 2                    |
| Successful independent creation and upgrade validations before CLI |                  At least 3 | Before Stage 3                    |
| Generic platform verification after notes removal                  |                   100% pass | Before first Git template release |

### Measurable acceptance outcomes

- **Personal offline journey:** 20 notes actions survive offline reload, replay, and convergence with
  zero loss or duplication across 20 runs.
- **Authorized group journey:** two authorized users exchange 100 ordered changes with 100% final
  agreement with authoritative state across 20 runs.
- **Revoked group journey:** all 20 actions queued before revocation are rejected after replay, with
  zero inaccessible note content shown after revocation is learned.
- **Conflict journey:** all 20 stale edits are rejected, none silently overwrite newer accepted
  state, and every rejection offers a reconciliation outcome.
- **Repeated-action journey:** 100 retries of each accepted notes action produce exactly one
  authoritative effect.
- **Web parity journey:** 100% of equivalent supported notes actions produce matching authorization
  and authoritative outcomes through SPA and MPA.
- **Removability journey:** removing notes leaves 100% of generic platform verification passing and
  zero notes-specific product behavior.

## 7. Open Questions

1. **Group role set and invitation policy:** Which roles, invitation states, ownership-transfer
   rules, and last-administrator protections are required? Deferred because notes acceptance needs
   permission differences, but future product governance is not yet defined.
2. **Authentication assurance:** Which sign-in methods, recovery options, session lifetime, and
   step-up requirements belong in first release? Deferred because secure identity behavior is
   required, while user-risk profile and deployment context remain unknown.
3. **Conflict user experience:** Should rejected changes support copy, manual comparison, retry, or
   discard beyond required reconciliation? Deferred because authority behavior is fixed, but target
   product interaction patterns are not.
4. **Revoked-data retention:** Must inaccessible local data be deleted immediately, after a short
   recovery period, or under administrator policy once revocation is learned? Deferred because
   privacy, device-sharing, and recovery expectations may conflict.
5. **Data portability and deletion:** What export, account deletion, group deletion, and retention
   commitments must first release support? Deferred until legal markets and adopter requirements
   are known.
6. **Browser support:** Which browser versions and device classes define acceptance coverage?
   Deferred because target audiences for first adopting applications are not selected.
7. **Performance environment:** What device, network, server load, and data-size profile defines the
   five-second synchronization target? Deferred so performance evidence remains reproducible for
   actual adopter conditions.
