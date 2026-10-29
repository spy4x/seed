import type { Catalog } from "@spy4x/platform/universal/i18n"

export default {
  "Mail.sentBy": "— Gesendet von",
  "Mail.signIn": "Anmelden",
  "Mail.openProfile": "Zum Profil",
  "Mail.openGroup": "Zur Gruppe",
  "PasswordResetMail.subject": "Setze dein Passwort zurück",
  "PasswordResetMail.asked": "Jemand möchte das Passwort deines Kontos bei {host} zurücksetzen.",
  "PasswordResetMail.open": {
    "one": "Öffne diesen Link innerhalb von {count} Minute, um ein neues Passwort festzulegen.",
    "other": "Öffne diesen Link innerhalb von {count} Minuten, um ein neues Passwort festzulegen.",
  },
  "PasswordResetMail.button": "Neues Passwort festlegen",
  "PasswordResetMail.once":
    "Der Link funktioniert nur einmal. Sobald du ihn benutzt, wirst du auf allen Geräten abgemeldet.",
  "PasswordResetMail.ignore":
    "Warst du das nicht? Dann ignoriere diese E-Mail einfach. Dein Passwort bleibt, wie es ist.",
  "SignInLinkMail.subject": "Dein Anmeldelink für {host}",
  "SignInLinkMail.asked":
    "Jemand wollte sich am {when} mit dieser E-Mail-Adresse bei {host} anmelden.",
  "SignInLinkMail.open": {
    "one":
      "Öffne diesen Link innerhalb von {count} Minute, um dich anzumelden. Gibt es mit dieser E-Mail-Adresse noch kein Konto, wird eins angelegt.",
    "other":
      "Öffne diesen Link innerhalb von {count} Minuten, um dich anzumelden. Gibt es mit dieser E-Mail-Adresse noch kein Konto, wird eins angelegt.",
  },
  "SignInLinkMail.button": "Bei {host} anmelden",
  "SignInLinkMail.once":
    "Der Link funktioniert nur einmal. Er öffnet eine Seite mit einem Weiter-Button, und erst wenn du darauf klickst, passiert etwas.",
  "SignInLinkMail.ignore":
    "Warst du das nicht? Dann ignoriere diese E-Mail einfach. Ohne den Link kann sich niemand anmelden.",
  "EmailCodeMail.subject": "Dein Code zum Bestätigen deiner E-Mail-Adresse",
  "EmailCodeMail.asked": "Gib diesen Code bei {host} ein, um deine E-Mail-Adresse zu bestätigen.",
  "EmailCodeMail.valid": {
    "one": "Er funktioniert einmal und gilt {count} Minute lang.",
    "other": "Er funktioniert einmal und gilt {count} Minuten lang.",
  },
  "EmailCodeMail.ignore":
    "Warst du das nicht? Dann ignoriere diese E-Mail einfach. Es ändert sich nichts.",
  "InvitationMail.subject": "Du bist zu „{group}“ eingeladen",
  "InvitationMail.invited":
    "<strong>{who}</strong> hat dich eingeladen, „{group}“ bei {host} als {role} beizutreten.",
  "InvitationMail.invitedNoName":
    "Du bist eingeladen, „{group}“ bei {host} als {role} beizutreten.",
  "InvitationMail.open": {
    "one": "Öffne die Einladung innerhalb von {count} Tag, um sie anzunehmen oder abzulehnen.",
    "other": "Öffne die Einladung innerhalb von {count} Tagen, um sie anzunehmen oder abzulehnen.",
  },
  "InvitationMail.button": "Einladung öffnen",
  "InvitationMail.account":
    "Die Einladung gilt für diese E-Mail-Adresse. Nimm sie also mit dem Konto an, das zu dieser Adresse gehört.",
  "InvitationMail.ignore": "Wenn du nicht beitreten möchtest, ignoriere diese E-Mail einfach.",
  "AccountDeletionMail.subject": "Dein Konto wird am {date} gelöscht",
  "AccountDeletionMail.asked":
    "Wie gewünscht wird dein Konto bei {host} am <strong>{date}</strong> endgültig gelöscht.",
  "AccountDeletionMail.keep":
    "Doch anders überlegt? Melde dich bis dahin an, dann bleibt dein Konto bestehen.",
  "AccountDeletionMail.notYou":
    "Warst du das nicht? Dann melde dich jetzt an, um dein Konto zu behalten, und ändere danach dein Passwort.",
  "AccountRestoredMail.subject": "Dein Konto wird nicht gelöscht",
  "AccountRestoredMail.restored":
    "Jemand hat sich bei deinem Konto auf {host} angemeldet, deshalb wird es nun doch nicht gelöscht.",
  "AccountRestoredMail.notYou":
    "Warst du das nicht? Dann melde dich an, ändere dein Passwort und lösche dein Konto noch einmal.",
  "DataExportReadyMail.subject": "Deine Daten sind bereit",
  "DataExportReadyMail.ready":
    "Du kannst sie bis zum <strong>{date}</strong> in deinem Profil herunterladen.",
  "DataExportReadyMail.notYou":
    "Warst du das nicht? Dann ändere dein Passwort und melde dich auf deinen anderen Geräten ab.",
  "SignInMethodMail.passkeyAddedSubject": "Neuer Passkey für dein Konto",
  "SignInMethodMail.passkeyAdded":
    "Am {when} wurde deinem Konto bei {host} ein Passkey hinzugefügt. Ab jetzt kann man sich damit anmelden.",
  "SignInMethodMail.passkeyAddedNotYou":
    "Warst du das nicht? Dann entferne den Passkey in deinem Profil und ändere dein Passwort.",
  "SignInMethodMail.passkeyRemovedSubject": "Ein Passkey wurde aus deinem Konto entfernt",
  "SignInMethodMail.passkeyRemoved":
    "Am {when} wurde ein Passkey aus deinem Konto bei {host} entfernt. Mit ihm kann man sich nicht mehr anmelden.",
  "SignInMethodMail.passkeyRemovedNotYou":
    "Warst du das nicht? Dann melde dich an, ändere dein Passwort und füge deinen Passkey wieder hinzu.",
  "SignInMethodMail.linkedSubject": "{provider} ist jetzt mit deinem Konto verknüpft",
  "SignInMethodMail.linked":
    "Am {when} wurde {provider} mit deinem Konto bei {host} verknüpft. Du kannst dich jetzt darüber anmelden.",
  "SignInMethodMail.linkedNotYou":
    "Warst du das nicht? Dann trenne {provider} in deinem Profil und ändere dein Passwort.",
  "SignInMethodMail.unlinkedSubject": "{provider} ist nicht mehr mit deinem Konto verknüpft",
  "SignInMethodMail.unlinked":
    "Am {when} wurde {provider} von deinem Konto bei {host} getrennt. Du kannst dich nicht mehr darüber anmelden.",
  "SignInMethodMail.unlinkedNotYou":
    "Warst du das nicht? Dann melde dich an, ändere dein Passwort und verknüpfe {provider} wieder.",
  "ApiTokenMail.subject": "Neues API-Token erstellt",
  "ApiTokenMail.created": "Für dein Konto bei {host} wurde ein API-Token namens „{name}“ erstellt.",
  "ApiTokenMail.readUntil": "Es kann die Gruppe „{group}“ lesen und läuft am {date} ab.",
  "ApiTokenMail.readForever": "Es kann die Gruppe „{group}“ lesen und läuft nie ab.",
  "ApiTokenMail.writeUntil":
    "Es kann die Gruppe „{group}“ lesen und ändern und läuft am {date} ab.",
  "ApiTokenMail.writeForever": "Es kann die Gruppe „{group}“ lesen und ändern und läuft nie ab.",
  "ApiTokenMail.notYou":
    "Warst du das nicht? Dann widerrufe das Token in deinem Profil und ändere dein Passwort. Damit werden alle API-Tokens widerrufen.",
  "BillingNoticeMail.paidPlan": "den bezahlten Tarif",
  "BillingNoticeMail.trialSubject": "Deine Testphase für {plan} endet am {date}",
  "BillingNoticeMail.trialWhat":
    "Die Testphase von „{group}“ für {plan} endet am <strong>{date}</strong>.",
  "BillingNoticeMail.trialWithCard":
    "Danach beginnt das Abo, und deine Karte wird belastet. Wenn du das nicht möchtest, kündige vorher auf der Seite der Gruppe.",
  "BillingNoticeMail.trialWithoutCard":
    "Wenn du den Tarif behalten möchtest, hinterlege vorher eine Karte auf der Seite der Gruppe. Dann beginnt das Abo, und deine Karte wird belastet. Ohne Karte wechselt die Gruppe in den kostenlosen Tarif.",
  "BillingNoticeMail.paymentSubject": "Zahlung für {plan} fehlgeschlagen",
  "BillingNoticeMail.paymentWhat": "Eine Zahlung von „{group}“ für {plan} ist fehlgeschlagen.",
  "BillingNoticeMail.paymentKept":
    "Bis zum <strong>{date}</strong> behältst du den Tarif, während wir die Zahlung erneut versuchen. Damit er danach bleibt, aktualisiere die Karte auf der Seite der Gruppe.",
  "BillingNoticeMail.paymentFree":
    "Die Gruppe ist jetzt im kostenlosen Tarif. Um den alten Tarif zurückzubekommen, aktualisiere die Karte auf der Seite der Gruppe.",
  "BillingNoticeMail.planSubject": "Dein Abo für {plan} endet am {date}",
  "BillingNoticeMail.planWhat":
    "Das Abo von „{group}“ für {plan} wurde gekündigt und endet am <strong>{date}</strong>. Danach wechselt die Gruppe in den kostenlosen Tarif.",
  "BillingNoticeMail.planNext":
    "Doch anders überlegt? Verlängere es bis dahin auf der Seite der Gruppe.",
  "SubscriberConfirmMail.subject": "Bestätige dein Abo des Newsletters von {host}",
  "SubscriberConfirmMail.asked":
    "Jemand hat diese E-Mail-Adresse für Neuigkeiten von {host} angemeldet.",
  "SubscriberConfirmMail.within":
    "Bestätige innerhalb von drei Tagen, damit du die Neuigkeiten bekommst.",
  "SubscriberConfirmMail.button": "Bestätigen",
  "SubscriberConfirmMail.ignore":
    "Warst du das nicht? Dann ignoriere diese E-Mail einfach. Wir schicken dir nichts.",
  "SubscriberWelcomeMail.subject": "Du hast den Newsletter von {host} abonniert",
  "SubscriberWelcomeMail.subscribed": "Ab jetzt bekommst du Neuigkeiten von {host}.",
  "SubscriberWelcomeMail.reason":
    "Du bekommst diese E-Mail, weil du den Newsletter von {host} abonniert hast.",
  "SubscriberWelcomeMail.unsubscribe": "Abbestellen",
  "SubscriberIssue.reason":
    "Du bekommst diese E-Mail, weil du den Newsletter von {host} abonniert hast.",
  "SubscriberIssue.readPost": "Beitrag lesen",
} satisfies Catalog
