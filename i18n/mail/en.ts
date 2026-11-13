import type { Catalog } from "@spy4x/platform/universal/i18n"

export default {
  "Mail.sentBy": "— Sent by",
  "Mail.signIn": "Sign in",
  "Mail.openProfile": "Open your profile",
  "Mail.openGroup": "Open the group",
  "Mail.dontShare": "Don't share this code. {host} will never ask you for it.",
  "PasswordResetMail.subject": "Your code to reset your password",
  "PasswordResetMail.asked":
    "Someone asked to reset the password of your account at {host}. Enter this code in the tab where you asked:",
  "PasswordResetMail.valid": {
    "one": "It works once, for {count} minute. Using it signs you out on every device.",
    "other": "It works once, for {count} minutes. Using it signs you out on every device.",
  },
  "PasswordResetMail.ignore":
    "If you didn't ask for this, ignore this email. Your password won't change.",
  "PasswordResetNoticeMail.subject": "Reset your password",
  "PasswordResetNoticeMail.asked":
    "The team behind {host} sent you this so you can choose a new password for your account.",
  "PasswordResetNoticeMail.how":
    "Open the page below and enter this email. We'll send you a code there, and you choose the new password.",
  "PasswordResetNoticeMail.button": "Reset your password",
  "PasswordResetNoticeMail.ignore":
    "If you don't want a new password, ignore this email. Your password won't change.",
  "SignInCodeMail.subject": "Your sign-in code for {host}",
  "SignInCodeMail.asked":
    "Someone asked to sign in to {host} with this email on {when}. Enter this code in the tab where you asked:",
  "SignInCodeMail.valid": {
    "one": "It works once, for {count} minute. If no account uses this email yet, it creates one.",
    "other":
      "It works once, for {count} minutes. If no account uses this email yet, it creates one.",
  },
  "SignInCodeMail.ignore":
    "If you didn't ask for this, ignore this email. Nobody can sign in without the code.",
  "EmailCodeMail.subject": "Your code to confirm your email",
  "EmailCodeMail.asked": "Enter this code at {host} to confirm your email.",
  "EmailCodeMail.valid": {
    "one": "It works once, for {count} minute.",
    "other": "It works once, for {count} minutes.",
  },
  "EmailCodeMail.ignore": "If you didn't ask for this, ignore this email. Nothing will change.",
  "InvitationMail.subject": 'You\'re invited to join "{group}"',
  "InvitationMail.invited":
    '<strong>{who}</strong> invited you to join "{group}" at {host} as {role}.',
  "InvitationMail.invitedNoName": 'You\'re invited to join "{group}" at {host} as {role}.',
  "InvitationMail.open": {
    "one": "Open the invitation within {count} day to accept or decline it.",
    "other": "Open the invitation within {count} days to accept or decline it.",
  },
  "InvitationMail.button": "Open the invitation",
  "InvitationMail.account":
    "The invitation is for this email, so accept it from the account that uses this email.",
  "InvitationMail.ignore": "If you don't want to join, just ignore this email.",
  "AccountDeletionMail.subject": "Your account will be deleted on {date}",
  "AccountDeletionMail.asked":
    "As you asked, your account at {host} will be deleted for good on <strong>{date}</strong>.",
  "AccountDeletionMail.keep": "Changed your mind? Sign in before then to keep your account.",
  "AccountDeletionMail.notYou":
    "If you didn't ask for this, sign in now to keep your account, then change your password.",
  "AccountRestoredMail.subject": "Your account won't be deleted",
  "AccountRestoredMail.restored":
    "Someone signed in to your account at {host}, so it won't be deleted after all.",
  "AccountRestoredMail.notYou":
    "If this wasn't you, sign in, change your password and delete your account again.",
  "DataExportReadyMail.subject": "Your data is ready",
  "DataExportReadyMail.ready": "Download it from your profile until <strong>{date}</strong>.",
  "DataExportReadyMail.notYou":
    "If you didn't ask for this, change your password and sign out of your other devices.",
  "SignInMethodMail.passkeyAddedSubject": "A passkey was added to your account",
  "SignInMethodMail.passkeyAdded":
    "A passkey was added to your account at {host} on {when}. It can now be used to sign in.",
  "SignInMethodMail.passkeyAddedNotYou":
    "If this wasn't you, remove the passkey in your profile and change your password.",
  "SignInMethodMail.passkeyRemovedSubject": "A passkey was removed from your account",
  "SignInMethodMail.passkeyRemoved":
    "A passkey was removed from your account at {host} on {when}. It can no longer be used to sign in.",
  "SignInMethodMail.passkeyRemovedNotYou":
    "If this wasn't you, sign in, change your password and add your passkey again.",
  "SignInMethodMail.linkedSubject": "{provider} was linked to your account",
  "SignInMethodMail.linked":
    "{provider} was linked to your account at {host} on {when}. You can now sign in with it.",
  "SignInMethodMail.linkedNotYou":
    "If this wasn't you, unlink {provider} in your profile and change your password.",
  "SignInMethodMail.unlinkedSubject": "{provider} was unlinked from your account",
  "SignInMethodMail.unlinked":
    "{provider} was unlinked from your account at {host} on {when}. You can no longer sign in with it.",
  "SignInMethodMail.unlinkedNotYou":
    "If this wasn't you, sign in, change your password and link {provider} again.",
  "ApiTokenMail.subject": "A new API token was created",
  "ApiTokenMail.created": 'An API token named "{name}" was created for your account at {host}.',
  "ApiTokenMail.readUntil": 'It can read the group "{group}" and expires on {date}.',
  "ApiTokenMail.readForever": 'It can read the group "{group}" and never expires.',
  "ApiTokenMail.writeUntil": 'It can read and change the group "{group}" and expires on {date}.',
  "ApiTokenMail.writeForever": 'It can read and change the group "{group}" and never expires.',
  "ApiTokenMail.notYou":
    "If this wasn't you, revoke the token in your profile and change your password. Changing it revokes every API token.",
  "BillingNoticeMail.paidPlan": "paid",
  "BillingNoticeMail.trialSubject": "Your {plan} trial ends on {date}",
  "BillingNoticeMail.trialWhat": 'The {plan} trial for "{group}" ends on <strong>{date}</strong>.',
  "BillingNoticeMail.trialWithCard":
    "Then the subscription starts and your card is charged. To stop it, cancel before then on the group's page.",
  "BillingNoticeMail.trialWithoutCard":
    "To keep the plan, add a card on the group's page before then. The subscription then starts and your card is charged. Without a card, the group moves to the free plan.",
  "BillingNoticeMail.paymentSubject": "A payment for {plan} failed",
  "BillingNoticeMail.paymentWhat": 'A payment for the {plan} plan of "{group}" failed.',
  "BillingNoticeMail.paymentKept":
    "You keep the plan until <strong>{date}</strong> while we try the payment again. To keep it after that, update the card on the group's page.",
  "BillingNoticeMail.paymentFree":
    "The group is now on the free plan. To get the plan back, update the card on the group's page.",
  "BillingNoticeMail.planSubject": "Your {plan} plan ends on {date}",
  "BillingNoticeMail.planWhat":
    'The {plan} plan of "{group}" was cancelled and ends on <strong>{date}</strong>. Then the group moves to the free plan.',
  "BillingNoticeMail.planNext": "Changed your mind? Renew it on the group's page before then.",
  "SubscriberConfirmMail.subject": "Confirm your subscription to {host}",
  "SubscriberConfirmMail.asked": "Someone signed this email up for news from {host}.",
  "SubscriberConfirmMail.within": "Confirm within three days to start getting it.",
  "SubscriberConfirmMail.button": "Confirm",
  "SubscriberConfirmMail.ignore":
    "If you didn't ask for this, ignore this email. We won't send you anything.",
  "SubscriberWelcomeMail.subject": "You're subscribed to {host}",
  "SubscriberWelcomeMail.subscribed": "You're subscribed to news from {host}.",
  "SubscriberWelcomeMail.reason": "You're getting this email because you subscribed at {host}.",
  "SubscriberWelcomeMail.unsubscribe": "Unsubscribe",
  "SubscriberIssue.reason": "You're getting this email because you subscribed at {host}.",
  "SubscriberIssue.readPost": "Read the post",
} satisfies Catalog
