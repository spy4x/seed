import {
  PictureCancelCommand,
  PictureConfirmCommand,
  PictureRemoveCommand,
  PictureSignCommand,
} from "@domain/identity"
import {
  createPictureCancelHandler,
  createPictureConfirmHandler,
  createPictureRemoveHandler,
  createPictureSignHandler,
} from "../features/profile/picture.ts"
import { pictureDependencies } from "./picture-dependencies.ts"
import { commandBus } from "@api/services/commandBus.ts"
import {
  AttachmentCancelCommand,
  AttachmentConfirmCommand,
  AttachmentDownloadQuery,
  AttachmentListQuery,
  AttachmentRemoveCommand,
  AttachmentSignCommand,
} from "@domain/notes"
import {
  createAttachmentCancelHandler,
  createAttachmentConfirmHandler,
  createAttachmentDownloadHandler,
  createAttachmentListHandler,
  createAttachmentRemoveHandler,
  createAttachmentSignHandler,
} from "../features/notes/attachments.ts"
import { attachmentDependencies } from "./attachment-dependencies.ts"
import { queryBus } from "@api/services/queryBus.ts"
import { subscribe } from "@api/services/eventBus.ts"
import { sql } from "@api/services/db.ts"
import { log } from "@api/services/log.ts"
import { createIdempotencyMiddleware, PostgresIdempotencyStore } from "@spy4x/server/idempotency"
import { entitlementGate } from "@api/cqrs/entitlements.ts"
import { useCommandMiddleware } from "@api/cqrs/command-middleware.ts"
import {
  OnboardingMarkCommand,
  PreferencesDeviceCommand,
  PreferencesSaveCommand,
  PushRegisterCommand,
  PushRemoveCommand,
  UserProfileUpdateCommand,
} from "@api/cqrs/commands.ts"
import {
  OnboardingGetQuery,
  PreferencesGetQuery,
  PushListQuery,
  UserProfileGetQuery,
} from "@api/cqrs/queries.ts"
import {
  GroupActivityQuery,
  GroupCreateCommand,
  GroupDeleteCommand,
  GroupDeletedListQuery,
  GroupExportCommand,
  GroupGetQuery,
  GroupImportCheckQuery,
  GroupImportCommand,
  GroupInvitationAcceptCommand,
  GroupInvitationCreateCommand,
  GroupInvitationDeclineCommand,
  GroupInvitationRevokeCommand,
  GroupInvitationsQuery,
  GroupLeaveCommand,
  GroupListQuery,
  GroupMemberRemoveCommand,
  GroupMemberRoleCommand,
  GroupMembersQuery,
  GroupMoveAllCommand,
  GroupRenameCommand,
  GroupRestoreCommand,
  GroupSelectCommand,
  GroupSelectedQuery,
  GroupTransferCommand,
  GroupUpdateDetailsCommand,
  InvitationPreviewQuery,
  MyInvitationsQuery,
} from "@domain/groups"
import {
  createInvitationAcceptHandler,
  createInvitationCreateHandler,
  createInvitationDeclineHandler,
  createInvitationListHandler,
  createInvitationPreviewHandler,
  createInvitationRevokeHandler,
  createMyInvitationsHandler,
} from "../features/groups/invitations.ts"
import { invitationDependencies } from "./invitation-dependencies.ts"
import { userProfileUpdateHandler } from "@api/cqrs/command-handlers/user-profile-update.ts"
import { userProfileGetHandler } from "@api/cqrs/query-handlers/user-profile-get.ts"
import { pushRegisterHandler } from "@api/cqrs/command-handlers/push-register.ts"
import { pushRemoveHandler } from "@api/cqrs/command-handlers/push-remove.ts"
import { pushListHandler } from "@api/cqrs/query-handlers/push-list.ts"
import { onboardingGetHandler } from "@api/cqrs/query-handlers/onboarding-get.ts"
import { onboardingMarkHandler } from "@api/cqrs/command-handlers/onboarding-mark.ts"
import { preferencesGetHandler } from "@api/cqrs/query-handlers/preferences-get.ts"
import { preferencesSaveHandler } from "@api/cqrs/command-handlers/preferences-save.ts"
import { preferencesDeviceHandler } from "@api/cqrs/command-handlers/preferences-device.ts"
import { groupCreateHandler } from "@api/cqrs/command-handlers/group-create.ts"
import { groupExportHandler, groupImportHandler } from "@api/cqrs/command-handlers/group-files.ts"
import { groupImportCheckHandler } from "@api/cqrs/query-handlers/group-import-check.ts"
import { groupGetHandler } from "@api/cqrs/query-handlers/group-get.ts"
import { groupListHandler } from "@api/cqrs/query-handlers/group-list.ts"
import { groupSelectHandler } from "@api/cqrs/command-handlers/group-select.ts"
import { groupRenameHandler } from "@api/cqrs/command-handlers/group-rename.ts"
import { groupUpdateDetailsHandler } from "@api/cqrs/command-handlers/group-update-details.ts"
import { groupDeleteHandler } from "@api/cqrs/command-handlers/group-delete.ts"
import { groupRestoreHandler } from "@api/cqrs/command-handlers/group-restore.ts"
import { groupDeletedListHandler } from "@api/cqrs/query-handlers/group-deleted-list.ts"
import { groupSelectedHandler } from "@api/cqrs/query-handlers/group-selected.ts"
import { groupMembersHandler } from "@api/cqrs/query-handlers/group-members.ts"
import {
  NotificationListQuery,
  NotificationMarkAllReadCommand,
  NotificationMarkReadCommand,
  NotificationUnreadCountQuery,
} from "@domain/notifications"
import {
  notificationListHandler,
  notificationUnreadCountHandler,
} from "@api/cqrs/query-handlers/notifications.ts"
import {
  notificationMarkAllReadHandler,
  notificationMarkReadHandler,
} from "@api/cqrs/command-handlers/notifications.ts"
import { groupActivityHandler } from "@api/cqrs/query-handlers/group-activity.ts"
import { groupMemberRoleHandler } from "@api/cqrs/command-handlers/group-member-role.ts"
import { groupMemberRemoveHandler } from "@api/cqrs/command-handlers/group-member-remove.ts"
import { groupLeaveHandler } from "@api/cqrs/command-handlers/group-leave.ts"
import { groupMoveAllHandler } from "@api/cqrs/command-handlers/group-move-all.ts"
import { groupTransferHandler } from "@api/cqrs/command-handlers/group-transfer.ts"
import {
  NoteAddedWidgetQuery,
  NoteCreateCommand,
  NoteDeleteCommand,
  NoteGetQuery,
  NoteListQuery,
  NoteLocateQuery,
  NoteMoveCommand,
  NoteRestoreCommand,
  NoteSearchQuery,
  NoteSeriesWidgetQuery,
  NoteTotalWidgetQuery,
  NoteUpdateCommand,
} from "@domain/notes"
import {
  TagCreateCommand,
  TagDeleteCommand,
  TagGetQuery,
  TagListQuery,
  TagUpdateCommand,
} from "@domain/tags"
import { tagCreateHandler } from "@api/cqrs/command-handlers/tag-create.ts"
import { tagUpdateHandler } from "@api/cqrs/command-handlers/tag-update.ts"
import { tagDeleteHandler } from "@api/cqrs/command-handlers/tag-delete.ts"
import { tagListHandler } from "@api/cqrs/query-handlers/tag-list.ts"
import { tagGetHandler } from "@api/cqrs/query-handlers/tag-get.ts"
import { noteCreateHandler } from "@api/cqrs/command-handlers/note-create.ts"
import { noteUpdateHandler } from "@api/cqrs/command-handlers/note-update.ts"
import { noteDeleteHandler } from "@api/cqrs/command-handlers/note-delete.ts"
import { noteRestoreHandler } from "@api/cqrs/command-handlers/note-restore.ts"
import { noteMoveHandler } from "@api/cqrs/command-handlers/note-move.ts"
import { noteListHandler } from "@api/cqrs/query-handlers/note-list.ts"
import {
  noteAddedWidgetHandler,
  noteSeriesWidgetHandler,
  noteTotalWidgetHandler,
} from "@api/cqrs/query-handlers/note-widgets.ts"
import { noteGetHandler } from "@api/cqrs/query-handlers/note-get.ts"
import { noteLocateHandler } from "@api/cqrs/query-handlers/note-locate.ts"
import { noteSearchHandler } from "@api/cqrs/query-handlers/note-search.ts"
import {
  BillingCheckoutCommand,
  BillingGetQuery,
  BillingPortalCommand,
  BillingTrialQuery,
} from "@domain/billing"
import { billingCheckoutHandler } from "@api/cqrs/command-handlers/billing-checkout.ts"
import { billingPortalHandler } from "@api/cqrs/command-handlers/billing-portal.ts"
import { billingGetHandler } from "@api/cqrs/query-handlers/billing-get.ts"
import { billingTrialHandler } from "@api/cqrs/query-handlers/billing-trial.ts"
import {
  GroupOwnershipTransferredEvent,
  GroupSelectedEvent,
  OnboardingMarkedEvent,
  PreferencesUpdatedEvent,
  PushDevicesUpdatedEvent,
  UserProfileUpdatedEvent,
  UserSignedOutEvent,
} from "@api/cqrs/events.ts"
import { realtimeOnUserProfileUpdatedHandler } from "@api/cqrs/event-handlers/realtime-on-user-profile-updated.ts"
import { realtimeOnGroupSelectedHandler } from "@api/cqrs/event-handlers/realtime-on-group-selected.ts"
import { realtimeOnPushDevicesUpdatedHandler } from "@api/cqrs/event-handlers/realtime-on-push-devices-updated.ts"
import { realtimeOnOnboardingMarkedHandler } from "@api/cqrs/event-handlers/realtime-on-onboarding-marked.ts"
import { realtimeOnPreferencesUpdatedHandler } from "@api/cqrs/event-handlers/realtime-on-preferences-updated.ts"
import { realtimeOnUserSignedOutHandler } from "@api/cqrs/event-handlers/realtime-on-user-signed-out.ts"
import { pushOnOwnershipTransferredHandler } from "@api/cqrs/event-handlers/push-on-ownership-transferred.ts"

// Audit rows have no listener: sign-up, sign-in, sign-out and the profile change write their
// `auth_audits` row in the transaction of the change itself, so the change and its row are kept
// or undone together (#191).
//
// Every listener is best-effort: a failure is logged and counted (`services/eventBus.ts`) and
// nothing retries it, because the in-process bus holds no copy of the event.
//
// - The socket-closing listener is best-effort by nature: sockets live in this process and the
//   worker, which runs outbox jobs, cannot close them. Its durable backstop is already in place:
//   every socket is revalidated on a timer (`realtime.startRevalidation`) and before each
//   request, so a failure here delays the close by one interval at most.
// - The hint listeners are best-effort for the same reason. A hint a tab misses is caught up
//   by the read the page makes whenever its socket opens again.
// - The push to a group's new owner is a courtesy: the transfer is already committed, and the new
//   owner sees it in their groups whether the push arrives or not.
subscribe(UserSignedOutEvent, realtimeOnUserSignedOutHandler)
subscribe(UserProfileUpdatedEvent, realtimeOnUserProfileUpdatedHandler)
subscribe(PushDevicesUpdatedEvent, realtimeOnPushDevicesUpdatedHandler)
subscribe(OnboardingMarkedEvent, realtimeOnOnboardingMarkedHandler)
subscribe(PreferencesUpdatedEvent, realtimeOnPreferencesUpdatedHandler)
subscribe(GroupSelectedEvent, realtimeOnGroupSelectedHandler)
subscribe(GroupOwnershipTransferredEvent, pushOnOwnershipTransferredHandler)

// After the session gate (added where the bus is built), in the order `command-middleware.ts`
// explains. The idempotency store needs the database, so it is attached here and not there.
useCommandMiddleware(commandBus, {
  idempotency: createIdempotencyMiddleware({
    store: new PostgresIdempotencyStore(sql),
    onStoreFailure: log,
  }),
  entitlements: entitlementGate,
})

commandBus.register(UserProfileUpdateCommand, userProfileUpdateHandler)
commandBus.register(PushRegisterCommand, pushRegisterHandler)
commandBus.register(PushRemoveCommand, pushRemoveHandler)
commandBus.register(OnboardingMarkCommand, onboardingMarkHandler)
commandBus.register(PreferencesSaveCommand, preferencesSaveHandler)
commandBus.register(PreferencesDeviceCommand, preferencesDeviceHandler)
commandBus.register(GroupCreateCommand, groupCreateHandler)
commandBus.register(GroupSelectCommand, groupSelectHandler)
commandBus.register(GroupRenameCommand, groupRenameHandler)
commandBus.register(GroupUpdateDetailsCommand, groupUpdateDetailsHandler)
commandBus.register(GroupDeleteCommand, groupDeleteHandler)
commandBus.register(GroupRestoreCommand, groupRestoreHandler)
commandBus.register(GroupMemberRoleCommand, groupMemberRoleHandler)
commandBus.register(GroupMemberRemoveCommand, groupMemberRemoveHandler)
commandBus.register(GroupLeaveCommand, groupLeaveHandler)
commandBus.register(GroupTransferCommand, groupTransferHandler)
commandBus.register(GroupMoveAllCommand, groupMoveAllHandler)
commandBus.register(GroupExportCommand, groupExportHandler)
commandBus.register(GroupImportCommand, groupImportHandler)
commandBus.register(
  GroupInvitationCreateCommand,
  createInvitationCreateHandler(invitationDependencies),
)
commandBus.register(
  GroupInvitationRevokeCommand,
  createInvitationRevokeHandler(invitationDependencies),
)
commandBus.register(
  GroupInvitationAcceptCommand,
  createInvitationAcceptHandler(invitationDependencies),
)
commandBus.register(
  GroupInvitationDeclineCommand,
  createInvitationDeclineHandler(invitationDependencies),
)
commandBus.register(NoteCreateCommand, noteCreateHandler)
commandBus.register(NoteUpdateCommand, noteUpdateHandler)
commandBus.register(NoteDeleteCommand, noteDeleteHandler)
commandBus.register(NoteRestoreCommand, noteRestoreHandler)
commandBus.register(NoteMoveCommand, noteMoveHandler)
commandBus.register(TagCreateCommand, tagCreateHandler)
commandBus.register(AttachmentSignCommand, createAttachmentSignHandler(attachmentDependencies))
commandBus.register(
  AttachmentConfirmCommand,
  createAttachmentConfirmHandler(attachmentDependencies),
)
commandBus.register(AttachmentRemoveCommand, createAttachmentRemoveHandler(attachmentDependencies))
commandBus.register(AttachmentCancelCommand, createAttachmentCancelHandler(attachmentDependencies))
commandBus.register(PictureSignCommand, createPictureSignHandler(pictureDependencies))
commandBus.register(PictureConfirmCommand, createPictureConfirmHandler(pictureDependencies))
commandBus.register(PictureCancelCommand, createPictureCancelHandler(pictureDependencies))
commandBus.register(PictureRemoveCommand, createPictureRemoveHandler(pictureDependencies))
commandBus.register(TagUpdateCommand, tagUpdateHandler)
commandBus.register(TagDeleteCommand, tagDeleteHandler)
commandBus.register(BillingCheckoutCommand, billingCheckoutHandler)
commandBus.register(BillingPortalCommand, billingPortalHandler)
queryBus.register(UserProfileGetQuery, userProfileGetHandler)
queryBus.register(PushListQuery, pushListHandler)
queryBus.register(OnboardingGetQuery, onboardingGetHandler)
queryBus.register(PreferencesGetQuery, preferencesGetHandler)
queryBus.register(GroupListQuery, groupListHandler)
queryBus.register(GroupGetQuery, groupGetHandler)
queryBus.register(GroupImportCheckQuery, groupImportCheckHandler)
queryBus.register(GroupSelectedQuery, groupSelectedHandler)
queryBus.register(GroupDeletedListQuery, groupDeletedListHandler)
queryBus.register(GroupMembersQuery, groupMembersHandler)
queryBus.register(GroupActivityQuery, groupActivityHandler)
queryBus.register(GroupInvitationsQuery, createInvitationListHandler(invitationDependencies))
queryBus.register(InvitationPreviewQuery, createInvitationPreviewHandler(invitationDependencies))
queryBus.register(MyInvitationsQuery, createMyInvitationsHandler(invitationDependencies))
queryBus.register(NoteListQuery, noteListHandler)
queryBus.register(NoteGetQuery, noteGetHandler)
queryBus.register(NoteLocateQuery, noteLocateHandler)
queryBus.register(NoteSearchQuery, noteSearchHandler)
queryBus.register(NoteTotalWidgetQuery, noteTotalWidgetHandler)
queryBus.register(NoteAddedWidgetQuery, noteAddedWidgetHandler)
queryBus.register(NoteSeriesWidgetQuery, noteSeriesWidgetHandler)
queryBus.register(TagListQuery, tagListHandler)
queryBus.register(AttachmentListQuery, createAttachmentListHandler(attachmentDependencies))
queryBus.register(AttachmentDownloadQuery, createAttachmentDownloadHandler(attachmentDependencies))
queryBus.register(TagGetQuery, tagGetHandler)
queryBus.register(BillingGetQuery, billingGetHandler)
queryBus.register(BillingTrialQuery, billingTrialHandler)
queryBus.register(NotificationListQuery, notificationListHandler)
queryBus.register(NotificationUnreadCountQuery, notificationUnreadCountHandler)
commandBus.register(NotificationMarkReadCommand, notificationMarkReadHandler)
commandBus.register(NotificationMarkAllReadCommand, notificationMarkAllReadHandler)

console.log("✅ CQRS handlers initialized")
