import type { Catalog } from "@spy4x/platform/universal/i18n"

export default {
  "Mail.sentBy": "— Envoyé par",
  "Mail.signIn": "Se connecter",
  "Mail.openProfile": "Ouvrir votre profil",
  "Mail.openGroup": "Ouvrir le groupe",
  "Mail.dontShare": "Ne partagez pas ce code. {host} ne vous le demandera jamais.",
  "PasswordResetMail.subject": "Votre code pour réinitialiser votre mot de passe",
  "PasswordResetMail.asked":
    "Quelqu’un a demandé à réinitialiser le mot de passe de votre compte sur {host}. Saisissez ce code dans l’onglet où vous l’avez demandé :",
  "PasswordResetMail.valid": {
    "one":
      "Il ne sert qu’une fois et reste valable {count} minute. Son utilisation vous déconnecte de tous vos appareils.",
    "many":
      "Il ne sert qu’une fois et reste valable {count} minutes. Son utilisation vous déconnecte de tous vos appareils.",
    "other":
      "Il ne sert qu’une fois et reste valable {count} minutes. Son utilisation vous déconnecte de tous vos appareils.",
  },
  "PasswordResetMail.ignore":
    "Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail. Votre mot de passe ne changera pas.",
  "PasswordResetNoticeMail.subject": "Réinitialisez votre mot de passe",
  "PasswordResetNoticeMail.asked":
    "L’équipe de {host} vous envoie cet e-mail pour que vous puissiez choisir un nouveau mot de passe pour votre compte.",
  "PasswordResetNoticeMail.how":
    "Ouvrez la page ci-dessous et saisissez cette adresse e-mail. Nous vous y enverrons un code, et vous choisirez le nouveau mot de passe.",
  "PasswordResetNoticeMail.button": "Réinitialiser le mot de passe",
  "PasswordResetNoticeMail.ignore":
    "Si vous ne voulez pas de nouveau mot de passe, ignorez cet e-mail. Votre mot de passe ne changera pas.",
  "SignInCodeMail.subject": "Votre code de connexion à {host}",
  "SignInCodeMail.asked":
    "Quelqu’un a demandé à se connecter à {host} avec cette adresse e-mail le {when}. Saisissez ce code dans l’onglet où vous l’avez demandé :",
  "SignInCodeMail.valid": {
    "one":
      "Il ne sert qu’une fois et reste valable {count} minute. Si aucun compte n’utilise encore cette adresse e-mail, il en crée un.",
    "many":
      "Il ne sert qu’une fois et reste valable {count} minutes. Si aucun compte n’utilise encore cette adresse e-mail, il en crée un.",
    "other":
      "Il ne sert qu’une fois et reste valable {count} minutes. Si aucun compte n’utilise encore cette adresse e-mail, il en crée un.",
  },
  "SignInCodeMail.ignore":
    "Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail. Personne ne peut se connecter sans le code.",
  "EmailCodeMail.subject": "Votre code pour confirmer votre adresse e-mail",
  "EmailCodeMail.asked": "Saisissez ce code sur {host} pour confirmer votre adresse e-mail.",
  "EmailCodeMail.valid": {
    "one": "Il ne fonctionne qu’une fois, pendant {count} minute.",
    "many": "Il ne fonctionne qu’une fois, pendant {count} minutes.",
    "other": "Il ne fonctionne qu’une fois, pendant {count} minutes.",
  },
  "EmailCodeMail.ignore":
    "Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail. Rien ne changera.",
  "InvitationMail.subject": "Vous êtes invité à rejoindre « {group} »",
  "InvitationMail.invited":
    "<strong>{who}</strong> vous invite à rejoindre « {group} » sur {host} en tant que {role}.",
  "InvitationMail.invitedNoName":
    "Vous êtes invité à rejoindre « {group} » sur {host} en tant que {role}.",
  "InvitationMail.open": {
    "one": "Ouvrez l’invitation dans un délai de {count} jour pour l’accepter ou la refuser.",
    "many": "Ouvrez l’invitation dans un délai de {count} jours pour l’accepter ou la refuser.",
    "other": "Ouvrez l’invitation dans un délai de {count} jours pour l’accepter ou la refuser.",
  },
  "InvitationMail.button": "Ouvrir l’invitation",
  "InvitationMail.account":
    "L’invitation est liée à cette adresse e-mail : acceptez-la depuis le compte qui utilise cette adresse.",
  "InvitationMail.ignore":
    "Si vous ne souhaitez pas rejoindre le groupe, ignorez simplement cet e-mail.",
  "AccountDeletionMail.subject": "Votre compte sera supprimé le {date}",
  "AccountDeletionMail.asked":
    "Comme vous l’avez demandé, votre compte sur {host} sera définitivement supprimé le <strong>{date}</strong>.",
  "AccountDeletionMail.keep":
    "Vous avez changé d’avis ? Connectez-vous avant cette date pour conserver votre compte.",
  "AccountDeletionMail.notYou":
    "Si vous n’êtes pas à l’origine de cette demande, connectez-vous dès maintenant pour conserver votre compte, puis changez votre mot de passe.",
  "AccountRestoredMail.subject": "Votre compte ne sera pas supprimé",
  "AccountRestoredMail.restored":
    "Quelqu’un s’est connecté à votre compte sur {host} : il ne sera donc finalement pas supprimé.",
  "AccountRestoredMail.notYou":
    "Si ce n’était pas vous, connectez-vous, changez votre mot de passe et supprimez à nouveau votre compte.",
  "DataExportReadyMail.subject": "Vos données sont prêtes",
  "DataExportReadyMail.ready":
    "Téléchargez-les depuis votre profil jusqu’au <strong>{date}</strong>.",
  "DataExportReadyMail.notYou":
    "Si vous n’êtes pas à l’origine de cette demande, changez votre mot de passe et déconnectez-vous de vos autres appareils.",
  "SignInMethodMail.passkeyAddedSubject": "Une clé d’accès a été ajoutée à votre compte",
  "SignInMethodMail.passkeyAdded":
    "Une clé d’accès a été ajoutée à votre compte sur {host} le {when}. Elle permet désormais de vous connecter.",
  "SignInMethodMail.passkeyAddedNotYou":
    "Si ce n’était pas vous, retirez la clé d’accès dans votre profil et changez votre mot de passe.",
  "SignInMethodMail.passkeyRemovedSubject": "Une clé d’accès a été retirée de votre compte",
  "SignInMethodMail.passkeyRemoved":
    "Une clé d’accès a été retirée de votre compte sur {host} le {when}. Elle ne permet plus de vous connecter.",
  "SignInMethodMail.passkeyRemovedNotYou":
    "Si ce n’était pas vous, connectez-vous, changez votre mot de passe et ajoutez à nouveau votre clé d’accès.",
  "SignInMethodMail.linkedSubject": "{provider} a été associé à votre compte",
  "SignInMethodMail.linked":
    "{provider} a été associé à votre compte sur {host} le {when}. Vous pouvez désormais l’utiliser pour vous connecter.",
  "SignInMethodMail.linkedNotYou":
    "Si ce n’était pas vous, dissociez {provider} dans votre profil et changez votre mot de passe.",
  "SignInMethodMail.unlinkedSubject": "{provider} a été dissocié de votre compte",
  "SignInMethodMail.unlinked":
    "{provider} a été dissocié de votre compte sur {host} le {when}. Vous ne pouvez plus l’utiliser pour vous connecter.",
  "SignInMethodMail.unlinkedNotYou":
    "Si ce n’était pas vous, connectez-vous, changez votre mot de passe et associez à nouveau {provider}.",
  "ApiTokenMail.subject": "Un nouveau jeton d’API a été créé",
  "ApiTokenMail.created":
    "Un jeton d’API nommé « {name} » a été créé pour votre compte sur {host}.",
  "ApiTokenMail.readUntil": "Il peut lire le groupe « {group} » et expire le {date}.",
  "ApiTokenMail.readForever": "Il peut lire le groupe « {group} » et n’expire jamais.",
  "ApiTokenMail.writeUntil": "Il peut lire et modifier le groupe « {group} » et expire le {date}.",
  "ApiTokenMail.writeForever": "Il peut lire et modifier le groupe « {group} » et n’expire jamais.",
  "ApiTokenMail.notYou":
    "Si ce n’était pas vous, révoquez le jeton dans votre profil et changez votre mot de passe. Changer votre mot de passe révoque tous vos jetons d’API.",
  "BillingNoticeMail.paidPlan": "payant",
  "BillingNoticeMail.trialSubject": "Votre essai du forfait {plan} se termine le {date}",
  "BillingNoticeMail.trialWhat":
    "L’essai du forfait {plan} pour « {group} » se termine le <strong>{date}</strong>.",
  "BillingNoticeMail.trialWithCard":
    "L’abonnement démarrera alors et votre carte sera débitée. Pour l’arrêter, résiliez avant cette date depuis la page du groupe.",
  "BillingNoticeMail.trialWithoutCard":
    "Pour garder le forfait, ajoutez une carte sur la page du groupe avant cette date. L’abonnement démarrera alors et votre carte sera débitée. Sans carte, le groupe passera au forfait Gratuit.",
  "BillingNoticeMail.paymentSubject": "Un paiement pour le forfait {plan} a échoué",
  "BillingNoticeMail.paymentWhat": "Un paiement pour le forfait {plan} de « {group} » a échoué.",
  "BillingNoticeMail.paymentKept":
    "Vous gardez le forfait jusqu’au <strong>{date}</strong> pendant que nous retentons le paiement. Pour le conserver au-delà, mettez à jour la carte sur la page du groupe.",
  "BillingNoticeMail.paymentFree":
    "Le groupe est maintenant au forfait Gratuit. Pour retrouver votre forfait, mettez à jour la carte sur la page du groupe.",
  "BillingNoticeMail.planSubject": "Votre forfait {plan} se termine le {date}",
  "BillingNoticeMail.planWhat":
    "Le forfait {plan} de « {group} » a été résilié et se termine le <strong>{date}</strong>. Le groupe passera ensuite au forfait Gratuit.",
  "BillingNoticeMail.planNext":
    "Vous avez changé d’avis ? Renouvelez-le sur la page du groupe avant cette date.",
  "SubscriberConfirmMail.subject": "Confirmez votre abonnement à {host}",
  "SubscriberConfirmMail.asked":
    "Quelqu’un a inscrit cette adresse e-mail pour recevoir les nouvelles de {host}.",
  "SubscriberConfirmMail.within": "Confirmez dans les trois jours pour commencer à les recevoir.",
  "SubscriberConfirmMail.button": "Confirmer",
  "SubscriberConfirmMail.ignore":
    "Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail. Nous ne vous enverrons rien.",
  "SubscriberWelcomeMail.subject": "Vous êtes abonné à {host}",
  "SubscriberWelcomeMail.subscribed": "Vous êtes abonné aux nouvelles de {host}.",
  "SubscriberWelcomeMail.reason":
    "Vous recevez cet e-mail parce que vous vous êtes abonné sur {host}.",
  "SubscriberWelcomeMail.unsubscribe": "Se désabonner",
  "SubscriberIssue.reason": "Vous recevez cet e-mail parce que vous vous êtes abonné sur {host}.",
  "SubscriberIssue.readPost": "Lire l’article",
} satisfies Catalog
