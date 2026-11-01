import type { Catalog } from "@spy4x/platform/universal/i18n"

export default {
  "AppShell.attachFiles": "Joindre des fichiers à cette note",
  "AttachmentMessages.load": "Impossible de charger les fichiers",
  "AttachmentMessages.type":
    "Impossible de joindre {name}. Seuls les fichiers PDF et les images JPEG, PNG, WebP et GIF sont acceptés.",
  "AttachmentMessages.size": "{name} pèse {size}. Chaque fichier peut peser jusqu’à {max}.",
  "AttachmentMessages.noteFull": {
    "one": "Une note peut contenir jusqu’à {count} fichier. {name} n’a pas été joint.",
    "many": "Une note peut contenir jusqu’à {count} fichiers. {name} n’a pas été joint.",
    "other": "Une note peut contenir jusqu’à {count} fichiers. {name} n’a pas été joint.",
  },
  "AttachmentMessages.pending":
    "{name} n’a pas été joint : attendez la fin des importations en cours, puis réessayez.",
  "AttachmentMessages.budget":
    "{name} n’a pas été joint : vous avez atteint la limite d’importations par heure. Réessayez plus tard.",
  "AttachmentMessages.uploadFailed": "Échec de l’importation.",
  "AttachmentMessages.overflow": {
    "one":
      "Une note peut contenir jusqu’à {max} fichiers. {count} fichier n’a pas été joint : {names}.",
    "many":
      "Une note peut contenir jusqu’à {max} fichiers. {count} fichiers n’ont pas été joints : {names}.",
    "other":
      "Une note peut contenir jusqu’à {max} fichiers. {count} fichiers n’ont pas été joints : {names}.",
  },
  "AttachmentMessages.uploaded": "{name} importé",
  "AttachmentMessages.notReallyPdf": "{name} n’est pas vraiment un PDF, il n’a donc pas été joint.",
  "AttachmentMessages.notReallyJpeg":
    "{name} n’est pas vraiment une image JPEG, elle n’a donc pas été jointe.",
  "AttachmentMessages.notReallyPng":
    "{name} n’est pas vraiment une image PNG, elle n’a donc pas été jointe.",
  "AttachmentMessages.notReallyWebp":
    "{name} n’est pas vraiment une image WebP, elle n’a donc pas été jointe.",
  "AttachmentMessages.notReallyGif":
    "{name} n’est pas vraiment une image GIF, elle n’a donc pas été jointe.",
  "AttachmentMessages.remove":
    "Impossible de retirer {name}. Vérifiez votre connexion et réessayez.",
  "AttachmentMessages.linkExpired": "Ce lien a expiré. Réessayez.",
  "Frame.overview": "Accueil",
  "Frame.notes": "Notes",
  "Frame.activity": "Activité",
  "Frame.groups": "Groupes",
  "Frame.search": "Recherche",
  "Frame.tags": "Étiquettes",
  "Frame.shortcuts": "Raccourcis clavier",
  "Frame.signOut": "Se déconnecter",
  "Frame.user": "Utilisateur",
  "GroupActivity.forbidden":
    "Seuls les administrateurs et le propriétaire peuvent voir l’activité.",
  "GroupActivity.forbiddenHint":
    "Demandez à un administrateur si vous voulez savoir ce qui a changé.",
  "GroupActivity.loading": "Chargement de l’activité…",
  "GroupActivity.empty": "Il ne s’est encore rien passé.",
  "GroupActivity.emptyHint": "Les modifications du groupe et de ses notes apparaissent ici.",
  "GroupActivity.loadingMore": "Chargement…",
  "GroupActivity.loadMore": "Afficher plus",
  "GroupActivity.openNote": "Ouvrir la note",
  "GroupActivity.openNoteNamed": "Ouvrir la note « {title} »",
  "GroupActivity.supportTeam": "Équipe d’assistance",
  "GroupActivity.deletedUser": "Utilisateur supprimé",
  "GroupActivity.someone": "Quelqu’un",
  "GroupActivity.roleUnknown": "Membre",
  "GroupActivity.created": "<who>{who}</who> a créé le groupe",
  "GroupActivity.renamed": "<who>{who}</who> a renommé le groupe",
  "GroupActivity.renamedFromTo":
    "<who>{who}</who> a renommé le groupe « <value>{from}</value> » en « <value>{to}</value> »",
  "GroupActivity.detailsUpdated":
    "<who>{who}</who> a modifié la description, la couleur ou l’emoji du groupe",
  "GroupActivity.deleted": "<who>{who}</who> a supprimé le groupe",
  "GroupActivity.restored": "<who>{who}</who> a restauré le groupe",
  "GroupActivity.roleChanged": "<who>{who}</who> a modifié le rôle de <target>{target}</target>",
  "GroupActivity.roleChangedSomeone": "<who>{who}</who> a modifié le rôle d’un membre",
  "GroupActivity.roleChangedFromTo":
    "<who>{who}</who> a fait passer <target>{target}</target> du rôle {fromRole} au rôle {toRole}",
  "GroupActivity.roleChangedFromToSomeone":
    "<who>{who}</who> a fait passer un membre du rôle {fromRole} au rôle {toRole}",
  "GroupActivity.memberRemoved": "<who>{who}</who> a retiré <target>{target}</target> du groupe",
  "GroupActivity.memberRemovedSomeone": "<who>{who}</who> a retiré un membre du groupe",
  "GroupActivity.memberLeft": "<who>{who}</who> a quitté le groupe",
  "GroupActivity.ownershipTransferred":
    "<who>{who}</who> a fait de <target>{target}</target> le propriétaire du groupe",
  "GroupActivity.ownershipTransferredSomeone":
    "<who>{who}</who> a fait d’un membre le propriétaire du groupe",
  "GroupActivity.invited": "<who>{who}</who> a invité quelqu’un à rejoindre le groupe",
  "GroupActivity.invitedAs":
    "<who>{who}</who> a invité quelqu’un à rejoindre le groupe en tant que {role}",
  "GroupActivity.invitationAccepted": "<who>{who}</who> a rejoint le groupe",
  "GroupActivity.invitationRevoked": "<who>{who}</who> a retiré une invitation",
  "GroupActivity.invitationDeclined": "<who>{who}</who> a refusé une invitation",
  "GroupActivity.dataMovedOut": {
    "one":
      "<who>{who}</who> a déplacé toutes les données du groupe ({count} élément) vers <value>{group}</value>",
    "many":
      "<who>{who}</who> a déplacé toutes les données du groupe ({count} éléments) vers <value>{group}</value>",
    "other":
      "<who>{who}</who> a déplacé toutes les données du groupe ({count} éléments) vers <value>{group}</value>",
  },
  "GroupActivity.dataMovedOutElsewhere": {
    "one":
      "<who>{who}</who> a déplacé toutes les données du groupe ({count} élément) vers un autre groupe",
    "many":
      "<who>{who}</who> a déplacé toutes les données du groupe ({count} éléments) vers un autre groupe",
    "other":
      "<who>{who}</who> a déplacé toutes les données du groupe ({count} éléments) vers un autre groupe",
  },
  "GroupActivity.dataMovedOutUncounted":
    "<who>{who}</who> a déplacé toutes les données du groupe (plusieurs éléments) vers <value>{group}</value>",
  "GroupActivity.dataMovedOutUncountedElsewhere":
    "<who>{who}</who> a déplacé toutes les données du groupe (plusieurs éléments) vers un autre groupe",
  "GroupActivity.dataMovedIn": {
    "one": "<who>{who}</who> a déplacé ici toutes les données d’un autre groupe ({count} élément)",
    "many":
      "<who>{who}</who> a déplacé ici toutes les données d’un autre groupe ({count} éléments)",
    "other":
      "<who>{who}</who> a déplacé ici toutes les données d’un autre groupe ({count} éléments)",
  },
  "GroupActivity.dataMovedInUncounted":
    "<who>{who}</who> a déplacé ici toutes les données d’un autre groupe (plusieurs éléments)",
  "GroupActivity.exported": "<who>{who}</who> a exporté le groupe dans un fichier",
  "GroupActivity.imported": {
    "one": "<who>{who}</who> a créé le groupe à partir d’un fichier d’export ({count} élément)",
    "many": "<who>{who}</who> a créé le groupe à partir d’un fichier d’export ({count} éléments)",
    "other": "<who>{who}</who> a créé le groupe à partir d’un fichier d’export ({count} éléments)",
  },
  "GroupActivity.importedUncounted":
    "<who>{who}</who> a créé le groupe à partir d’un fichier d’export (plusieurs éléments)",
  "GroupActivity.noteCreated": "<who>{who}</who> a ajouté la note « <value>{title}</value> »",
  "GroupActivity.noteCreatedUntitled": "<who>{who}</who> a ajouté une note",
  "GroupActivity.noteDeleted": "<who>{who}</who> a supprimé la note « <value>{title}</value> »",
  "GroupActivity.noteDeletedUntitled": "<who>{who}</who> a supprimé une note",
  "GroupActivity.noteRestored": "<who>{who}</who> a restauré la note « <value>{title}</value> »",
  "GroupActivity.noteRestoredUntitled": "<who>{who}</who> a restauré une note",
  "GroupActivity.notesMovedOut": {
    "one": "<who>{who}</who> a déplacé {count} note vers <value>{group}</value>",
    "many": "<who>{who}</who> a déplacé {count} notes vers <value>{group}</value>",
    "other": "<who>{who}</who> a déplacé {count} notes vers <value>{group}</value>",
  },
  "GroupActivity.notesMovedOutElsewhere": {
    "one": "<who>{who}</who> a déplacé {count} note vers un autre groupe",
    "many": "<who>{who}</who> a déplacé {count} notes vers un autre groupe",
    "other": "<who>{who}</who> a déplacé {count} notes vers un autre groupe",
  },
  "GroupActivity.notesMovedOutUncounted":
    "<who>{who}</who> a déplacé des notes vers <value>{group}</value>",
  "GroupActivity.notesMovedOutUncountedElsewhere":
    "<who>{who}</who> a déplacé des notes vers un autre groupe",
  "GroupActivity.notesMovedIn": {
    "one": "<who>{who}</who> a déplacé ici {count} note d’un autre groupe",
    "many": "<who>{who}</who> a déplacé ici {count} notes d’un autre groupe",
    "other": "<who>{who}</who> a déplacé ici {count} notes d’un autre groupe",
  },
  "GroupActivity.notesMovedInUncounted":
    "<who>{who}</who> a déplacé ici des notes d’un autre groupe",
  "GroupActivity.fileAdded":
    "<who>{who}</who> a joint le fichier « <value>{name}</value> » à « <value>{title}</value> »",
  "GroupActivity.fileAddedNoNote": "<who>{who}</who> a joint le fichier « <value>{name}</value> »",
  "GroupActivity.fileAddedUnnamed":
    "<who>{who}</who> a joint un fichier à « <value>{title}</value> »",
  "GroupActivity.fileAddedUnnamedNoNote": "<who>{who}</who> a joint un fichier",
  "GroupActivity.fileRemoved":
    "<who>{who}</who> a retiré le fichier « <value>{name}</value> » de « <value>{title}</value> »",
  "GroupActivity.fileRemovedNoNote":
    "<who>{who}</who> a retiré le fichier « <value>{name}</value> »",
  "GroupActivity.fileRemovedUnnamed":
    "<who>{who}</who> a retiré un fichier de « <value>{title}</value> »",
  "GroupActivity.fileRemovedUnnamedNoNote": "<who>{who}</who> a retiré un fichier",
  "GroupActivity.tagCreated": "<who>{who}</who> a ajouté l’étiquette « <value>{name}</value> »",
  "GroupActivity.tagCreatedUnnamed": "<who>{who}</who> a ajouté une étiquette",
  "GroupActivity.tagRenamed":
    "<who>{who}</who> a renommé l’étiquette « <value>{from}</value> » en « <value>{name}</value> »",
  "GroupActivity.tagChanged": "<who>{who}</who> a modifié l’étiquette « <value>{name}</value> »",
  "GroupActivity.tagChangedUnnamed": "<who>{who}</who> a modifié une étiquette",
  "GroupActivity.tagRecoloured":
    "<who>{who}</who> a changé la couleur de l’étiquette « <value>{name}</value> »",
  "GroupActivity.tagDeleted": "<who>{who}</who> a supprimé l’étiquette « <value>{name}</value> »",
  "GroupActivity.tagDeletedUnnamed": "<who>{who}</who> a supprimé une étiquette",
  "GroupActivity.tagDeletedCarried": {
    "one":
      "<who>{who}</who> a supprimé l’étiquette « <value>{name}</value> », utilisée sur {count} note",
    "many":
      "<who>{who}</who> a supprimé l’étiquette « <value>{name}</value> », utilisée sur {count} notes",
    "other":
      "<who>{who}</who> a supprimé l’étiquette « <value>{name}</value> », utilisée sur {count} notes",
  },
  "GroupActivity.tagDeletedUnnamedCarried": {
    "one": "<who>{who}</who> a supprimé une étiquette utilisée sur {count} note",
    "many": "<who>{who}</who> a supprimé une étiquette utilisée sur {count} notes",
    "other": "<who>{who}</who> a supprimé une étiquette utilisée sur {count} notes",
  },
  "GroupActivity.unknown": "<who>{who}</who> a modifié quelque chose dans le groupe",
  "GroupActivity.loadFailed": "Impossible de charger l’activité",
  "GroupActivity.loadMoreFailed": "Impossible de charger plus d’activité",
  "GroupEditor.back": "Retour aux groupes",
  "GroupEditor.newTitle": "Nouveau groupe",
  "GroupEditor.title": "Groupe",
  "GroupEditor.loading": "Chargement du groupe…",
  "GroupEditor.missing": "Ce groupe n’existe pas.",
  "GroupEditor.missingHint": "Il a peut-être été supprimé, ou vous n’en êtes pas membre.",
  "GroupEditor.cancelSubscriptionFirst": "Résiliez d’abord son abonnement",
  "GroupEditor.onlyGroup": "C’est votre seul groupe",
  "GroupEditor.switch": "Passer à ce groupe",
  "GroupEditor.transfer": "Transférer la propriété",
  "GroupEditor.export": "Exporter le groupe…",
  "GroupEditor.exporting": "Préparation…",
  "GroupEditor.offline": "Vous êtes hors ligne",
  "GroupEditor.moveAll": "Déplacer toutes les données…",
  "GroupEditor.leave": "Quitter le groupe",
  "GroupEditor.delete": "Supprimer le groupe",
  "GroupEditor.memberCount": {
    "one": "{count} membre",
    "many": "{count} membres",
    "other": "{count} membres",
  },
  "GroupEditor.memberCountLink": {
    "one": "{count} membre : voir le forfait et la facturation",
    "many": "{count} membres : voir le forfait et la facturation",
    "other": "{count} membres : voir le forfait et la facturation",
  },
  "GroupEditor.tabGeneral": "Général",
  "GroupEditor.tabMembers": "Membres",
  "GroupEditor.tabBilling": "Facturation",
  "GroupEditor.tabActivity": "Activité",
  "GroupEditor.tabsLabel": "À propos de {name}",
  "GroupEditor.currentGroup": "votre groupe actuel",
  "GroupEditor.invite": "Inviter",
  "GroupEditor.exportRetry": "Réessayer",
  "GroupEditor.exportFailed":
    "Impossible de préparer le fichier. Rien n’a changé dans votre groupe.",
  "GroupEditor.transferTitle": "Transférer « {name} »",
  "GroupEditor.moveAllTitle": "Déplacer toutes les données de « {name} »",
  "GroupEditor.close": "Fermer",
  "GroupEditor.cancel": "Annuler",
  "GroupEditor.leaveTitle": "Quitter « {name} » ?",
  "GroupEditor.leaveConfirmation":
    "Vous perdrez l’accès immédiatement, sur tous vos appareils. Ce que vous avez écrit reste dans le groupe. Pour revenir, quelqu’un devra vous inviter à nouveau.",
  "GroupEditor.deleteTitle": "Supprimer « {name} » ?",
  "GroupEditor.deleteConfirmation": {
    "one":
      "Il disparaît immédiatement pour tous les membres, avec tout son contenu. Les membres qui l’ont ouvert basculent vers un autre de leurs groupes, et ceux qui n’en ont plus aucun reçoivent un nouveau groupe vide nommé « Personnel ». Vous pouvez le restaurer depuis la page Groupes pendant {count} jour. Ensuite, il est supprimé définitivement avec tout son contenu.",
    "many":
      "Il disparaît immédiatement pour tous les membres, avec tout son contenu. Les membres qui l’ont ouvert basculent vers un autre de leurs groupes, et ceux qui n’en ont plus aucun reçoivent un nouveau groupe vide nommé « Personnel ». Vous pouvez le restaurer depuis la page Groupes pendant {count} jours. Ensuite, il est supprimé définitivement avec tout son contenu.",
    "other":
      "Il disparaît immédiatement pour tous les membres, avec tout son contenu. Les membres qui l’ont ouvert basculent vers un autre de leurs groupes, et ceux qui n’en ont plus aucun reçoivent un nouveau groupe vide nommé « Personnel ». Vous pouvez le restaurer depuis la page Groupes pendant {count} jours. Ensuite, il est supprimé définitivement avec tout son contenu.",
  },
  "GroupEditor.optional": "Facultatif",
  "GroupEditor.offlineCreate":
    "Vous pouvez remplir ce formulaire maintenant, mais il vous faut une connexion pour créer le groupe.",
  "GroupEditor.offlineSave":
    "Vous voyez la copie enregistrée sur cet appareil. Il vous faut une connexion pour enregistrer vos modifications.",
  "GroupEditor.name": "Nom",
  "GroupEditor.description": "Description",
  "GroupEditor.descriptionCount": {
    "one": "{used} sur {count} caractère",
    "many": "{used} sur {count} caractères",
    "other": "{used} sur {count} caractères",
  },
  "GroupEditor.descriptionPlaceholder": "À quoi sert ce groupe ?",
  "GroupEditor.emoji": "Emoji",
  "GroupEditor.emojiHint": "Affiché devant le nom du groupe.",
  "GroupEditor.colour": "Couleur",
  "GroupEditor.colourHint": "Affichée derrière le logo du groupe.",
  "GroupEditor.discard": "Abandonner",
  "GroupEditor.creating": "Création…",
  "GroupEditor.saving": "Enregistrement…",
  "GroupEditor.create": "Créer le groupe",
  "GroupEditor.save": "Enregistrer le groupe",
  "GroupEditor.trialUsed":
    "Les nouveaux groupes démarrent avec le forfait Gratuit. Vous avez déjà utilisé votre essai gratuit : un forfait payant sera donc facturé ici dès le premier jour.",
  "GroupEditor.trial": {
    "one":
      "Les nouveaux groupes démarrent avec le forfait Gratuit. Votre essai gratuit de {count} jour s’applique au premier groupe que vous passez à un forfait payant.",
    "many":
      "Les nouveaux groupes démarrent avec le forfait Gratuit. Votre essai gratuit de {count} jours s’applique au premier groupe que vous passez à un forfait payant.",
    "other":
      "Les nouveaux groupes démarrent avec le forfait Gratuit. Votre essai gratuit de {count} jours s’applique au premier groupe que vous passez à un forfait payant.",
  },
  "GroupEditor.readOnly":
    "Seuls les administrateurs et le propriétaire peuvent modifier les informations de ce groupe.",
  "GroupEditor.nameRequired": "Saisissez un nom.",
  "GroupEditor.nameInvalid":
    "100 caractères maximum, sans retour à la ligne ni caractère invisible.",
  "GroupEditor.descriptionTooLong": {
    "one": "{count} caractère maximum.",
    "many": "{count} caractères maximum.",
    "other": "{count} caractères maximum.",
  },
  "GroupEditor.emojiInvalid": "Utilisez un seul emoji, comme 🏕️, ou laissez le champ vide.",
  "GroupEditor.createFailed": "Impossible de créer le groupe. Réessayez.",
  "GroupEditor.createOffline":
    "Il vous faut une connexion pour créer un groupe. Réessayez une fois de retour en ligne.",
  "GroupEditor.saveOffline":
    "Il vous faut une connexion pour enregistrer un groupe. Réessayez une fois de retour en ligne.",
  "GroupEditor.created": "Groupe créé",
  "GroupEditor.createdBody": "« {name} » est maintenant votre groupe actuel.",
  "GroupEditor.saved": "Groupe enregistré",
  "GroupEditor.savedBody": "« {name} » enregistré.",
  "GroupEditor.savedBodyUnnamed": "Le groupe est enregistré.",
  "GroupEditor.discardTitle": "Abandonner vos modifications ?",
  "GroupEditor.discardNew": "Vous n’avez pas encore créé ce groupe.",
  "GroupEditor.discardExisting": "Vous n’avez pas enregistré vos modifications de « {name} ».",
  "GroupEditor.discardLeave": "Abandonner les modifications",
  "GroupEditor.discardStay": "Continuer à modifier",
  "GroupEditor.discardExistingUnnamed":
    "Vous n’avez pas enregistré vos modifications de ce groupe.",
  "GroupImport.notes": {
    "one": "{count} note",
    "many": "{count} notes",
    "other": "{count} notes",
  },
  "GroupImport.tags": {
    "one": "{count} étiquette",
    "many": "{count} étiquettes",
    "other": "{count} étiquettes",
  },
  "GroupImport.settings": "paramètres",
  "GroupImport.newerVersion":
    "Ce fichier provient d’une version plus récente de l’application. Mettez l’application à jour, ou exportez à nouveau depuis une version correspondante.",
  "GroupImport.notExport": "Ce n’est pas un fichier d’export de groupe.",
  "GroupImport.tooLarge": "Le fichier dépasse {size} Mo.",
  "GroupImport.checking": "Vérification du fichier…",
  "GroupImport.contains": "Contenu : {contents}.",
  "GroupImport.refused": "Ce fichier ne peut pas être importé. Rien n’a été enregistré.",
  "GroupImport.unchecked": "Impossible de vérifier le fichier.",
  "GroupImport.title": "Importer un groupe",
  "GroupImport.back": "Retour aux groupes",
  "GroupImport.intro":
    "Créez un nouveau groupe à partir d’un fichier d’export. Vos groupes existants restent tels quels.",
  "GroupImport.offlineTitle": "Vous êtes hors ligne",
  "GroupImport.offline":
    "Il vous faut une connexion pour vérifier et importer un fichier. Votre fichier reste sélectionné.",
  "GroupImport.file": "Fichier d’export",
  "GroupImport.fileHint": "Un fichier .json exporté depuis un groupe, jusqu’à {size} Mo.",
  "GroupImport.browse": "Choisir un fichier",
  "GroupImport.chooseAnother": "Choisir un autre fichier",
  "GroupImport.retry": "Réessayer",
  "GroupImport.uncheckedHint": "Vérifiez votre connexion et réessayez. Rien n’a été enregistré.",
  "GroupImport.more": {
    "one": "et {count} autre",
    "many": "et {count} autres",
    "other": "et {count} autres",
  },
  "GroupImport.planTitle": "Ce fichier est trop volumineux pour le forfait d’un nouveau groupe",
  "GroupImport.plan": {
    "one":
      "Un nouveau groupe démarre avec le forfait Gratuit, qui contient jusqu’à {count} note. Ce fichier en contient {notes}.",
    "many":
      "Un nouveau groupe démarre avec le forfait Gratuit, qui contient jusqu’à {count} notes. Ce fichier en contient {notes}.",
    "other":
      "Un nouveau groupe démarre avec le forfait Gratuit, qui contient jusqu’à {count} notes. Ce fichier en contient {notes}.",
  },
  "GroupImport.failed": "L’importation s’est arrêtée et rien n’a été enregistré. Réessayez.",
  "GroupImport.name": "Nom",
  "GroupImport.importing": "Importation…",
  "GroupImport.submit": "Importer le groupe",
  "GroupImport.imported": "Groupe importé",
  "GroupImport.importedBody": "Importé dans « {name} » : {contents}.",
  "GroupImport.nameInvalid": "Donnez au groupe un nom de 1 à 100 caractères.",
  "GroupInvitations.viewersOnly":
    "Avec le forfait de ce groupe, les invitations ne peuvent ajouter que des lecteurs. Passez à un forfait payant pour inviter aussi des éditeurs et des administrateurs.",
  "GroupInvitations.copyNow": "Copiez ce lien maintenant. Vous ne pourrez plus le revoir.",
  "GroupInvitations.copyNowMailed":
    "Copiez ce lien maintenant. Vous ne pourrez plus le revoir. Nous l’avons aussi envoyé par e-mail.",
  "GroupInvitations.copyNowMailFailed":
    "Copiez ce lien maintenant. Vous ne pourrez plus le revoir. L’e-mail n’a pas pu être envoyé : partagez le lien vous-même.",
  "GroupInvitations.copyLink": "Copier le lien d’invitation",
  "GroupInvitations.linkCopied": "Lien copié",
  "GroupInvitations.done": "Terminé",
  "GroupInvitations.formHint":
    "Toute personne disposant du lien peut rejoindre le groupe avec son rôle, jusqu’à ce qu’il expire ou atteigne son nombre d’utilisations. Les invitations en attente ne comptent pas dans la limite de membres du forfait, mais les invitations acceptées, si.",
  "GroupInvitations.role": "Rôle",
  "GroupInvitations.email": "Adresse e-mail (facultatif)",
  "GroupInvitations.emailHint":
    "Seul le compte qui a confirmé cette adresse e-mail peut accepter cette invitation, qui ne laisse entrer qu’une seule personne.",
  "GroupInvitations.sendEmail": "Envoyer le lien à cette adresse",
  "GroupInvitations.days": "Expire après (jours)",
  "GroupInvitations.uses": "Nombre de personnes pouvant rejoindre",
  "GroupInvitations.cancel": "Annuler",
  "GroupInvitations.creating": "Création…",
  "GroupInvitations.create": "Créer l’invitation",
  "GroupInvitations.pending": "Invitations en attente",
  "GroupInvitations.anyone": "Toute personne disposant du lien",
  "GroupInvitations.usage": {
    "one": "utilisée {uses} fois sur {count} · expire le <value>{date}</value>",
    "many": "utilisée {uses} fois sur {count} · expire le <value>{date}</value>",
    "other": "utilisée {uses} fois sur {count} · expire le <value>{date}</value>",
  },
  "GroupInvitations.usageBy": {
    "one":
      "utilisée {uses} fois sur {count} · expire le <value>{date}</value> · par <name>{name}</name>",
    "many":
      "utilisée {uses} fois sur {count} · expire le <value>{date}</value> · par <name>{name}</name>",
    "other":
      "utilisée {uses} fois sur {count} · expire le <value>{date}</value> · par <name>{name}</name>",
  },
  "GroupInvitations.actions": "Actions pour l’invitation de {who}",
  "GroupInvitations.revoke": "Révoquer",
  "GroupInvitations.revokeTitle": "Révoquer cette invitation ?",
  "GroupInvitations.revokeConfirmation":
    "Le lien destiné à <value>{email}</value> cesse de fonctionner immédiatement. Les personnes qui l’ont utilisé pour rejoindre le groupe y restent.",
  "GroupInvitations.revokeConfirmationLink":
    "Ce lien cesse de fonctionner immédiatement. Les personnes qui l’ont utilisé pour rejoindre le groupe y restent.",
  "GroupInvitations.opening": "Ouverture de l’invitation…",
  "GroupInvitations.unusable": "Cette invitation ne peut pas être utilisée",
  "GroupInvitations.toGroups": "Accéder à vos groupes",
  "GroupInvitations.invitedYou": "<name>{name}</name> vous invite à rejoindre",
  "GroupInvitations.invitedYouSomeone": "<name>Quelqu’un</name> vous invite à rejoindre",
  "GroupInvitations.asRole": "en tant que <role>{role}</role> · expire le <value>{date}</value>",
  "GroupInvitations.joining": "Vous rejoignez le groupe…",
  "GroupInvitations.accept": "Accepter l’invitation",
  "GroupInvitations.acceptShort": "Accepter",
  "GroupInvitations.decline": "Refuser",
  "GroupInvitations.forYou": "Invitations pour vous",
  "GroupInvitations.invitedYouAs": "<name>{name}</name> vous invite en tant que {role}",
  "GroupInvitations.invitedYouAsSomeone": "<name>Quelqu’un</name> vous invite en tant que {role}",
  "GroupInvitations.declineNamed": "Refuser l’invitation à {name}",
  "GroupInvitations.acceptNamed": "Accepter l’invitation à {name}",
  "GroupInvitations.verifyEmail": "Vérifier l’adresse e-mail",
  "GroupInvitations.notForYou":
    "Cette invitation a été envoyée à une autre adresse e-mail. Si c’est la vôtre, confirmez-la d’abord dans votre <link>profil</link>, ou connectez-vous avec le compte qui l’utilise.",
  "GroupInvitations.somethingWrong": "Un problème est survenu. Réessayez.",
  "GroupInvitations.unreachable": "Impossible de joindre le serveur. Réessayez.",
  "GroupMembers.unnamed": "Membre sans nom",
  "GroupMembers.title": "Membres",
  "GroupMembers.titleCount": "Membres ({total})",
  "GroupMembers.loading": "Chargement des membres…",
  "GroupMembers.cutOff": {
    "one": "Affichage des {shown} premiers membres sur {count}.",
    "many": "Affichage des {shown} premiers membres sur {count}.",
    "other": "Affichage des {shown} premiers membres sur {count}.",
  },
  "GroupMembers.you": "vous",
  "GroupMembers.lastSeen": "Dernière visite : <value>{when}</value>",
  "GroupMembers.saving": "Enregistrement…",
  "GroupMembers.actions": "Actions pour {name}",
  "GroupMembers.makeViewer": "Nommer lecteur",
  "GroupMembers.makeEditor": "Nommer éditeur",
  "GroupMembers.makeAdmin": "Nommer administrateur",
  "GroupMembers.makeOwner": "Nommer propriétaire",
  "GroupMembers.remove": "Retirer du groupe",
  "GroupMembers.removeTitle": "Retirer {name} ?",
  "GroupMembers.removeConfirm": "Retirer le membre",
  "GroupMembers.cancel": "Annuler",
  "GroupMembers.removeConfirmation":
    "Cette personne perdra l’accès immédiatement, sur tous ses appareils. Ce qu’elle a écrit reste dans le groupe. Si c’était son seul groupe, elle reçoit un nouveau groupe vide nommé « Personnel ». Si elle possède encore un lien d’invitation, elle peut revenir avec un autre compte : révoquez donc aussi ces liens.",
  "GroupMembers.loadFailed": "Impossible de charger les membres",
  "GroupMembers.roleFailed": "Impossible de modifier le rôle",
  "GroupMembers.removeFailed": "Impossible de retirer le membre",
  "GroupMembers.leaveFailed": "Impossible de quitter le groupe",
  "GroupMoveAll.explanation":
    "Toutes les notes et étiquettes de « <value>{name}</value> » sont déplacées vers le groupe choisi, et les membres de ce groupe-ci ne les voient plus. Les membres de l’autre groupe les voient immédiatement. Chaque note conserve son historique de modifications. En cas d’échec, rien n’est déplacé.",
  "GroupMoveAll.to": "Tout déplacer vers",
  "GroupMoveAll.cancel": "Annuler",
  "GroupMoveAll.moving": "Déplacement…",
  "GroupMoveAll.submit": "Tout déplacer",
  "GroupMoveAll.notes": {
    "one": "{count} note",
    "many": "{count} notes",
    "other": "{count} notes",
  },
  "GroupMoveAll.tags": {
    "one": "{count} étiquette",
    "many": "{count} étiquettes",
    "other": "{count} étiquettes",
  },
  "GroupMoveAll.done":
    "Vous avez déplacé {notes} de « <value>{from}</value> » vers « <value>{to}</value> ». Les notes supprimées restent dans ce groupe et disparaissent avec lui si vous le supprimez.",
  "GroupMoveAll.doneWithTags":
    "Vous avez déplacé {notes} et {tags} de « <value>{from}</value> » vers « <value>{to}</value> ». Les notes supprimées restent dans ce groupe et disparaissent avec lui si vous le supprimez.",
  "GroupMoveAll.keep": "Garder le groupe",
  "GroupMoveAll.delete": "Supprimer « {name} »…",
  "GroupMoveAll.failed": "Impossible de déplacer les données",
  "GroupMoveAll.otherGroup": "l’autre groupe",
  "GroupPicker.label": "Groupe : {name}",
  "GroupPicker.choose": "Choisir un groupe",
  "GroupPicker.tip": "{name} · {role}",
  "GroupPicker.menu": "Changer de groupe",
  "GroupPicker.all": "Tous les groupes",
  "GroupPicker.new": "Nouveau groupe",
  "GroupPicker.sheetHeading": "Groupe",
  "GroupTransfer.explanation":
    "Cette personne devient propriétaire et vous devenez administrateur. Seul le propriétaire peut supprimer le groupe, gérer son forfait ou le transférer à nouveau. Avant de pouvoir supprimer votre compte, transférez chaque groupe que vous partagez avec d’autres personnes.",
  "GroupTransfer.newOwner": "Nouveau propriétaire",
  "GroupTransfer.typeName": "Saisissez « {name} » pour confirmer",
  "GroupTransfer.password": "Votre mot de passe",
  "GroupTransfer.cancel": "Annuler",
  "GroupTransfer.transferring": "Transfert…",
  "GroupTransfer.transfer": "Transférer la propriété",
  "GroupTransfer.failed": "Impossible de transférer le groupe",
  "GroupTransfer.unreachable": "Impossible de joindre le serveur. Réessayez.",
  "GroupTransfer.tooManyAttempts":
    "Trop de tentatives. Patientez quelques minutes, puis réessayez.",
  "GroupTransfer.somethingWrong": "Un problème est survenu. Réessayez.",
  "Groups.title": "Groupes",
  "Groups.new": "Nouveau groupe",
  "Groups.import": "Importer un groupe…",
  "Groups.loading": "Chargement des groupes…",
  "Groups.retry": "Réessayer",
  "Groups.empty": "Aucun groupe pour l’instant",
  "Groups.emptyHint":
    "Tout ce que vous mettez dans un groupe est partagé avec les personnes que vous invitez.",
  "Groups.listLabel": "Vos groupes",
  "Groups.deleted": "Groupes supprimés ({count})",
  "Groups.deletedHint": {
    "one":
      "Vous pouvez restaurer un groupe supprimé, avec tout son contenu, pendant {count} jour. Ensuite, il est supprimé définitivement.",
    "many":
      "Vous pouvez restaurer un groupe supprimé, avec tout son contenu, pendant {count} jours. Ensuite, il est supprimé définitivement.",
    "other":
      "Vous pouvez restaurer un groupe supprimé, avec tout son contenu, pendant {count} jours. Ensuite, il est supprimé définitivement.",
  },
  "Groups.restorableUntil": "Restaurable jusqu’au <value>{date}</value>",
  "Groups.restore": "Restaurer",
  "Groups.restoreNamed": "Restaurer {name}",
  "Groups.restoring": "Restauration…",
  "Groups.onlyYou": "Vous seul",
  "Groups.members": {
    "one": "{count} membre",
    "many": "{count} membres",
    "other": "{count} membres",
  },
  "Groups.current": "Actuel",
  "Groups.currentNamed": "{name}, groupe actuel",
  "Groups.roleViewer": "Lecteur",
  "Groups.roleEditor": "Éditeur",
  "Groups.roleAdmin": "Administrateur",
  "Groups.roleOwner": "Propriétaire",
  "Groups.loadFailed": "Impossible de charger les groupes",
  "Groups.deleteFailed": "Impossible de supprimer le groupe",
  "Groups.restoreFailed": "Impossible de restaurer le groupe",
  "InvitationNew.back": "Retour aux membres",
  "InvitationNew.offline":
    "Il vous faut une connexion pour créer une invitation. Réessayez une fois de retour en ligne.",
  "InvitationNew.offlineTitle": "Vous êtes hors ligne",
  "InvitationNew.copyTitle": "Copiez votre lien d’invitation",
  "InvitationNew.title": "Nouvelle invitation",
  "InvitationNew.notAllowed":
    "Seuls les administrateurs et le propriétaire peuvent inviter des personnes.",
  "InvitationNew.backToGroup": "Retour au groupe",
  "InvitationNew.loading": "Chargement du groupe…",
  "InvitationNew.missing": "Ce groupe n’existe pas.",
  "InvitationNew.missingHint": "Il a peut-être été supprimé, ou vous n’en êtes pas membre.",
  "InvitationNew.backToGroups": "Retour aux groupes",
  "InvitationNew.leaveTitle": "Partir sans copier ?",
  "InvitationNew.leaveMessage": "Vous ne pourrez plus revoir ce lien.",
  "InvitationNew.leave": "Partir",
  "InvitationNew.stay": "Rester",
  "InvitationNew.discardTitle": "Abandonner vos modifications ?",
  "InvitationNew.discardMessage": "Vous n’avez pas encore créé cette invitation.",
  "InvitationNew.discardLeave": "Abandonner les modifications",
  "InvitationNew.discardStay": "Continuer à modifier",
  "GroupBillingPanel.planFree": "Gratuit",
  "GroupBillingPanel.planPro": "Pro",
  "GroupBillingPanel.paymentFailed": {
    "one":
      "Un paiement a échoué. Pour conserver {plan}, mettez à jour votre carte avec « Changer de carte » d’ici {count} jour, avant le {date}.",
    "many":
      "Un paiement a échoué. Pour conserver {plan}, mettez à jour votre carte avec « Changer de carte » d’ici {count} jours, avant le {date}.",
    "other":
      "Un paiement a échoué. Pour conserver {plan}, mettez à jour votre carte avec « Changer de carte » d’ici {count} jours, avant le {date}.",
  },
  "GroupBillingPanel.paymentFailedFree":
    "Un paiement a échoué : le groupe est donc passé au forfait Gratuit. Mettez à jour votre carte avec « Changer de carte » pour retrouver {plan}.",
  "GroupBillingPanel.offline": "Impossible de joindre le serveur. Réessayez.",
  "GroupBillingPanel.unreadable": "Impossible de charger le forfait.",
  "GroupBillingPanel.unsafePage":
    "Le prestataire de paiement a renvoyé une adresse que cette application refuse d’ouvrir.",
  "GroupBillingPanel.checkoutUnreachable":
    "Impossible d’ouvrir la page de paiement Stripe. Vérifiez votre connexion et réessayez.",
  "GroupBillingPanel.portalUnreachable":
    "Impossible d’ouvrir la page de facturation Stripe. Vérifiez votre connexion et réessayez.",
  "GroupBillingPanel.title": "Facturation",
  "GroupBillingPanel.description":
    "Ce que <group>{group}</group> paie chaque mois. Stripe gère la facturation.",
  "GroupBillingPanel.loading": "Chargement du forfait",
  "GroupBillingPanel.statusTrial": "Essai",
  "GroupBillingPanel.statusRenews": "Renouvellement le {date}",
  "GroupBillingPanel.statusEnds": "Se termine le {date}",
  "GroupBillingPanel.statusPaymentFailed": "Paiement échoué",
  "GroupBillingPanel.off": "Tous les groupes sont sur le forfait Gratuit.",
  "GroupBillingPanel.ownerOnly":
    "Seul <name>{name}</name>, propriétaire du groupe, peut modifier son forfait ou consulter les factures.",
  "GroupBillingPanel.ownerOnlyUnknown":
    "Seul le propriétaire du groupe peut modifier son forfait ou consulter les factures.",
  "GroupBillingPanel.price": "{plan} coûte {price} par membre et par mois.",
  "GroupBillingPanel.priceForGroup": {
    "one": "Avec {count} membre, <group>{group}</group> paierait {total} par mois.",
    "many": "Avec {count} membres, <group>{group}</group> paierait {total} par mois.",
    "other": "Avec {count} membres, <group>{group}</group> paierait {total} par mois.",
  },
  "GroupBillingPanel.opening": "Ouverture de Stripe…",
  "GroupBillingPanel.opensStripe": "(ouvre Stripe)",
  "GroupBillingPanel.startTrial": {
    "one": "Commencer l’essai gratuit de {count} jour",
    "many": "Commencer l’essai gratuit de {count} jours",
    "other": "Commencer l’essai gratuit de {count} jours",
  },
  "GroupBillingPanel.upgrade": "Passer à {plan}",
  "GroupBillingPanel.trialUsed": "Vous avez déjà utilisé votre essai gratuit sur un autre groupe.",
  "GroupBillingPanel.finePrint":
    "Facturé chaque mois, par membre. Résiliez à tout moment et gardez {plan} jusqu’à la fin de la période.",
  "GroupBillingPanel.trialEnds": {
    "one": "L’essai se termine dans {count} jour, le {date}.",
    "many": "L’essai se termine dans {count} jours, le {date}.",
    "other": "L’essai se termine dans {count} jours, le {date}.",
  },
  "GroupBillingPanel.trialThen":
    "Ensuite, <group>{group}</group> paiera {total} par mois, sauf si vous résiliez.",
  "GroupBillingPanel.seats": {
    "one": "{total} par mois, pour {count} membre à {price} chacun, propriétaire compris.",
    "many": "{total} par mois, pour {count} membres à {price} chacun, propriétaire compris.",
    "other": "{total} par mois, pour {count} membres à {price} chacun, propriétaire compris.",
  },
  "GroupBillingPanel.ending":
    "{plan} se termine le {date}. Le groupe passera ensuite au forfait Gratuit.",
  "GroupBillingPanel.endingNoDate":
    "{plan} se termine à la fin de la période en cours. Le groupe passera ensuite au forfait Gratuit.",
  "GroupBillingPanel.renew": "Renouveler {plan}",
  "GroupBillingPanel.planHeading": "Forfait <plan>{plan}</plan>",
  "GroupBillingPanel.confirming":
    "Stripe confirme votre forfait. Cette page se mettra à jour d’elle-même.",
  "GroupBillingPanel.paymentMethod": "Moyen de paiement",
  "GroupBillingPanel.paymentMethodText": "La carte que Stripe débite chaque mois.",
  "GroupBillingPanel.changeCard": "Changer de carte",
  "GroupBillingPanel.invoices": "Factures",
  "GroupBillingPanel.invoicesText": "Toutes vos factures et reçus, à consulter ou télécharger.",
  "GroupBillingPanel.viewInvoices": "Voir les factures",
  "GroupBillingPanel.cancelTitle": "Résilier {plan}",
  "GroupBillingPanel.cancelFree":
    "Aucun montant ne vous sera facturé si vous résiliez avant le {date}.",
  "GroupBillingPanel.cancelKeep": "Vous gardez {plan} jusqu’à la fin de la période.",
  "GroupBillingPanel.cancelPlan": "Résilier le forfait",
  "GroupBillingView.trialStarted": {
    "one": "Votre essai {plan} de {count} jour a commencé",
    "many": "Votre essai {plan} de {count} jours a commencé",
    "other": "Votre essai {plan} de {count} jours a commencé",
  },
  "GroupBillingView.trialUntil": "« {group} » bénéficie de {plan} jusqu’au {date}.",
  "GroupBillingView.paid": "Vous êtes passé à {plan}",
  "GroupBillingView.paidText": "Stripe a confirmé le paiement pour « {group} ».",
  "NotificationsScreen.loadFailed": "Impossible de charger les notifications.",
  "NotificationsScreen.loadMoreFailed": "Impossible de charger plus de notifications.",
  "NotificationsScreen.readFailed": "Impossible de la marquer comme lue.",
  "NotificationsScreen.readAllFailed": "Impossible de les marquer comme lues.",
  "NotificationsScreen.invitedViewer":
    "Vous êtes invité à rejoindre « <group>{group}</group> » en tant que lecteur.",
  "NotificationsScreen.invitedEditor":
    "Vous êtes invité à rejoindre « <group>{group}</group> » en tant qu’éditeur.",
  "NotificationsScreen.invitedAdmin":
    "Vous êtes invité à rejoindre « <group>{group}</group> » en tant qu’administrateur.",
  "NotificationsScreen.invitedOwner":
    "Vous êtes invité à rejoindre « <group>{group}</group> » en tant que propriétaire.",
  "NotificationsScreen.invitedMember":
    "Vous êtes invité à rejoindre « <group>{group}</group> » en tant que membre.",
  "NotificationsScreen.roleViewer": "Vous êtes maintenant lecteur dans « <group>{group}</group> ».",
  "NotificationsScreen.roleEditor": "Vous êtes maintenant éditeur dans « <group>{group}</group> ».",
  "NotificationsScreen.roleAdmin":
    "Vous êtes maintenant administrateur dans « <group>{group}</group> ».",
  "NotificationsScreen.roleOwner":
    "Vous êtes maintenant propriétaire de « <group>{group}</group> ».",
  "NotificationsScreen.roleMember": "Vous êtes maintenant membre de « <group>{group}</group> ».",
  "NotificationsScreen.invited": "Vous êtes invité à rejoindre « <group>{group}</group> ».",
  "NotificationsScreen.roleChanged": "Votre rôle dans « <group>{group}</group> » a changé.",
  "NotificationsScreen.removed": "Vous avez été retiré de « <group>{group}</group> ».",
  "NotificationsScreen.owned": "Vous êtes maintenant propriétaire de « <group>{group}</group> ».",
  "NotificationsScreen.someGroup": "un groupe",
  "NotificationsScreen.reminderFirstNote":
    "Gardez la note que vous venez d’écrire. Pour l’instant, elle n’existe que dans ce navigateur. Ajoutez une méthode de connexion pour l’ouvrir sur n’importe quel appareil.",
  "NotificationsScreen.reminderThirdVisit":
    "Envie de retrouver ce compte sur vos autres appareils ? Pour l’instant, seul ce navigateur peut l’ouvrir. Ajoutez une méthode de connexion pour l’utiliser partout.",
  "NotificationsScreen.reminderInvite":
    "Ajoutez une méthode de connexion pour inviter des personnes : elles voient qui les a invitées. Invitez-les ensuite depuis les paramètres du groupe.",
  "NotificationsScreen.reminderKeep": "Ajoutez une méthode de connexion pour garder votre compte.",
  "NotificationsScreen.exportReady":
    "Vos données sont prêtes. Téléchargez-les depuis votre profil.",
  "NotificationsScreen.exportReadyUntil":
    "Vos données sont prêtes. Téléchargez-les depuis votre profil avant le {date}.",
  "NotificationsScreen.unknown": "Vous avez une nouvelle notification.",
  "NotificationsScreen.title": "Notifications",
  "NotificationsScreen.unread": {
    "one": "{count} non lue",
    "many": "{count} non lues",
    "other": "{count} non lues",
  },
  "NotificationsScreen.readAll": "Tout marquer comme lu",
  "NotificationsScreen.loading": "Chargement…",
  "NotificationsScreen.empty": "Vous êtes à jour.",
  "NotificationsScreen.emptyText":
    "Les invitations et les modifications de vos groupes apparaissent ici.",
  "NotificationsScreen.loadMore": "Afficher plus",
  "NotificationsScreen.unreadMark": "Non lue :",
  "OnboardingCard.failed": "Impossible d’enregistrer. Réessayez.",
  "OnboardingCard.emailTitle": "Vérifiez votre adresse e-mail",
  "OnboardingCard.emailText":
    "Saisissez le code que nous vous avons envoyé : vous pourrez ainsi réinitialiser votre mot de passe si vous l’oubliez.",
  "OnboardingCard.emailAction": "Vérifier l’adresse e-mail",
  "OnboardingCard.noteTitle": "Écrivez votre première note",
  "OnboardingCard.noteText": "La note de bienvenue vient de nous. Écrivez la vôtre.",
  "OnboardingCard.noteAction": "Écrire une note",
  "OnboardingCard.inviteTitle": "Invitez quelqu’un dans votre groupe",
  "OnboardingCard.inviteText":
    "Cette personne verra les mêmes notes en direct, avec le rôle que vous lui donnez.",
  "OnboardingCard.inviteAction": "Inviter quelqu’un",
  "OnboardingCard.notificationsTitle": "Activez les notifications",
  "OnboardingCard.notificationsText":
    "Soyez informé des modifications, même quand l’application est fermée.",
  "OnboardingCard.notificationsAction": "Activer les notifications",
  "OnboardingCard.twoFactorTitle": "Configurez la double authentification",
  "OnboardingCard.twoFactorText":
    "Une application d’authentification protège votre compte, même si votre mot de passe fuite.",
  "OnboardingCard.twoFactorAction": "Configurer",
  "OnboardingCard.tourNotesTitle": "Notes",
  "OnboardingCard.tourNotesText":
    "Ce que vous et votre groupe écrivez. Ouvrez une note pour la modifier : tout le monde voit vos changements immédiatement.",
  "OnboardingCard.tourGroupsTitle": "Groupes",
  "OnboardingCard.tourGroupsText":
    "Les notes vivent dans des groupes. Créez des groupes ici, invitez des personnes et choisissez leur rôle.",
  "OnboardingCard.tourNotificationsTitle": "Notifications",
  "OnboardingCard.tourNotificationsText":
    "Ce qui s’est passé pendant votre absence, comme une invitation.",
  "OnboardingCard.tourProfileTitle": "Profil",
  "OnboardingCard.tourProfileText":
    "Votre compte : votre nom, votre mot de passe, la double authentification et vos appareils, le thème et la déconnexion.",
  "OnboardingCard.goTo": "Aller à {place}",
  "OnboardingCard.goToHighlighted": "Aller à l’élément mis en évidence",
  "OnboardingCard.title": "Bien démarrer",
  "OnboardingCard.tourOffer": "Nouveau ici ? Faites une visite rapide.",
  "OnboardingCard.tourStart": "Faire la visite",
  "OnboardingCard.tourSkip": "Passer la visite",
  "OnboardingCard.keep": "Gardez votre compte",
  "OnboardingCard.keepText":
    "Ajoutez une méthode de connexion pour ouvrir ce compte sur n’importe quel appareil.",
  "OverviewScreen.last7Days": "7 derniers jours",
  "OverviewScreen.last30Days": "30 derniers jours",
  "OverviewScreen.last90Days": "90 derniers jours",
  "OverviewScreen.last12Months": "12 derniers mois",
  "OverviewScreen.thisMonth": "Ce mois-ci",
  "OverviewScreen.lastMonth": "Le mois dernier",
  "OverviewScreen.custom": "Personnalisée…",
  "OverviewScreen.period": {
    "one": "{range}, comparé à la veille",
    "many": "{range}, comparé aux {count} jours précédents",
    "other": "{range}, comparé aux {count} jours précédents",
  },
  "OverviewScreen.title": "Vue d’ensemble",
  "OverviewScreen.customise": "Personnaliser la vue d’ensemble",
  "OverviewScreen.reset": "Réinitialiser la disposition",
  "OverviewScreen.copyLink": "Copier le lien vers cette vue",
  "OverviewScreen.loading": "Chargement du groupe…",
  "OverviewScreen.missing": "Ce groupe n’existe pas.",
  "OverviewScreen.backToGroups": "Retour aux groupes",
  "OverviewScreen.emptyGroup": "Aucune note dans {group} pour l’instant",
  "OverviewScreen.emptyGroupText":
    "La vue d’ensemble se remplit à mesure que les membres du groupe ajoutent des notes.",
  "OverviewScreen.newNote": "Nouvelle note",
  "OverviewScreen.allHidden": "Tous les widgets sont masqués",
  "OverviewScreen.allHiddenText": "Choisissez ceux que vous voulez voir.",
  "OverviewScreen.gridLabel": "Vue d’ensemble de {group}",
  "OverviewScreen.customiseText":
    "Choisissez les widgets à afficher et leur ordre. Votre disposition vous suit sur vos autres appareils.",
  "OverviewScreen.widgets": "Widgets",
  "OverviewScreen.customRange": "Période personnalisée",
  "OverviewScreen.rangeTooLong": "Choisissez une période d’un an maximum.",
  "OverviewScreen.asOf": "Mis à jour à {time}",
  "OverviewScreen.hide": "Masquer le widget",
  "OverviewView.opening": "Ouverture de la vue d’ensemble…",
  "OverviewView.saveFailed":
    "Impossible d’enregistrer votre disposition. Vérifiez votre connexion et réessayez.",
  "OverviewView.undo": "Annuler",
  "OverviewView.widget": "Widget",
  "OverviewView.hidden": "{widget} masqué.",
  "OverviewView.restored": "Disposition par défaut restaurée.",
  "OverviewView.linkCopied": "Lien copié",
  "PlanRefusalNotice.notesTitle": "{group} a atteint sa limite de notes",
  "PlanRefusalNotice.notesTitleUnnamed": "Ce groupe a atteint sa limite de notes",
  "PlanRefusalNotice.membersTitle": "{group} a atteint sa limite de membres",
  "PlanRefusalNotice.membersTitleUnnamed": "Ce groupe a atteint sa limite de membres",
  "PlanRefusalNotice.filesTitle": "{group} a atteint sa limite de fichiers",
  "PlanRefusalNotice.filesTitleUnnamed": "Ce groupe a atteint sa limite de fichiers",
  "PlanRefusalNotice.storageTitle": "{group} a utilisé tout son espace de stockage",
  "PlanRefusalNotice.storageTitleUnnamed": "Ce groupe a utilisé tout son espace de stockage",
  "PlanRefusalNotice.notesText": {
    "one":
      "Son forfait autorise jusqu’à {count} note. Les notes existantes restent lisibles et modifiables.",
    "many":
      "Son forfait autorise jusqu’à {count} notes. Les notes existantes restent lisibles et modifiables.",
    "other":
      "Son forfait autorise jusqu’à {count} notes. Les notes existantes restent lisibles et modifiables.",
  },
  "PlanRefusalNotice.membersText": {
    "one": "Son forfait autorise jusqu’à {count} membre.",
    "many": "Son forfait autorise jusqu’à {count} membres.",
    "other": "Son forfait autorise jusqu’à {count} membres.",
  },
  "PlanRefusalNotice.filesText": {
    "one":
      "Son forfait autorise jusqu’à {count} fichier pour l’ensemble des notes. Retirez un fichier d’une note pour libérer de la place.",
    "many":
      "Son forfait autorise jusqu’à {count} fichiers pour l’ensemble des notes. Retirez un fichier d’une note pour libérer de la place.",
    "other":
      "Son forfait autorise jusqu’à {count} fichiers pour l’ensemble des notes. Retirez un fichier d’une note pour libérer de la place.",
  },
  "PlanRefusalNotice.storageText": "Son forfait n’a plus de place pour d’autres fichiers.",
  "PlanRefusalNotice.rolesTitle": "Promouvoir des membres nécessite un forfait payant",
  "PlanRefusalNotice.rolesText":
    "Avec le forfait de ce groupe, vous pouvez abaisser le rôle d’un membre ou le retirer, mais pas le promouvoir.",
  "PlanRefusalNotice.openBilling": "Ouvrir la facturation",
  "PlanRefusalNotice.askOwner": "Demandez au propriétaire du groupe de changer de forfait.",
  "GuestProfile.accountType": "Type de compte",
  "GuestProfile.guestAccount": "Compte invité. Seul ce navigateur peut l’ouvrir.",
  "GuestProfile.methods": "Méthodes de connexion",
  "GuestProfile.noMethods": "Aucune méthode de connexion pour l’instant",
  "GuestProfile.noMethodsText": "Ajoutez-en une pour vous connecter sur un autre appareil.",
  "GuestProfile.danger": "Zone de danger",
  "GuestProfile.deleteSummary": "Supprime immédiatement ce compte invité et tout son contenu.",
  "GuestProfile.deleteTitle": "Supprimer ce compte invité ?",
  "GuestProfile.deleteText":
    "Ses notes et ses groupes sont supprimés immédiatement, et personne ne pourra les récupérer : un compte invité n’a aucune méthode de connexion permettant de le restaurer. Exportez d’abord un groupe si vous voulez en garder une copie.",
  "GuestProfile.typeWord": "Saisissez « {word} » pour confirmer",
  "GuestProfile.deleteForGood": "Supprimer définitivement",
  "GuestProfile.inviteTitle": "Inviter nécessite une méthode de connexion",
  "GuestProfile.inviteText":
    "Les personnes que vous invitez voient qui les a invitées, et un compte invité disparaît si les données de ce navigateur sont effacées. Ajoutez d’abord une méthode de connexion.",
  "GuestProfile.pushTitle":
    "Les notifications sur cet appareil nécessitent une méthode de connexion",
  "GuestProfile.pushText": "Ajoutez-en une, puis activez-les ici.",
  "GuestProfile.apiTokenTitle": "Les jetons d’API nécessitent une méthode de connexion",
  "GuestProfile.apiTokenText":
    "Un jeton ouvre ce compte depuis l’extérieur du navigateur. Ajoutez d’abord une méthode de connexion.",
  "GuestProfile.uploadTitle": "L’importation nécessite une méthode de connexion",
  "GuestProfile.uploadText": "Ajoutez-en d’abord une à votre compte, puis importez le fichier.",
  "GuestProfile.billingTitle": "Les forfaits payants nécessitent une méthode de connexion",
  "GuestProfile.billingText":
    "Les forfaits sont facturés à un compte auquel vous pouvez toujours vous reconnecter. Ajoutez d’abord une méthode de connexion.",
  "GuestProfile.telegramTitle": "Telegram nécessite une méthode de connexion",
  "GuestProfile.telegramText":
    "Une conversation associée agit en votre nom depuis l’extérieur du navigateur. Ajoutez d’abord une méthode de connexion.",
  "GuestProfile.otherTitle": "Cette action nécessite une méthode de connexion",
  "GuestProfile.otherText": "Ajoutez-en d’abord une à votre compte, puis réessayez.",
  "GuestProfile.notNow": "Pas maintenant",
  "GuestScreens.keep": "Gardez votre compte",
  "GuestScreens.createAccount": "Créer un compte",
  "GuestScreens.createInstead": "Créer plutôt un compte",
  "GuestScreens.tryTitle": "Essayer l’application",
  "GuestScreens.opening": "Ouverture de l’application…",
  "GuestScreens.rateLimited": "Trop de nouveaux comptes depuis votre réseau",
  "GuestScreens.failed": "Impossible d’ouvrir l’application",
  "GuestScreens.failedText": "Vérifiez votre connexion et réessayez.",
  "GuestScreens.tryAgain": "Réessayer",
  "GuestScreens.signedIn": "Vous êtes déjà connecté",
  "GuestScreens.signedInText":
    "Votre compte est ouvert dans ce navigateur. Déconnectez-vous d’abord pour essayer l’application en tant qu’invité.",
  "GuestScreens.openApp": "Ouvrir l’application",
  "GuestScreens.off": "Créez un compte pour commencer",
  "GuestScreens.offText": "Il n’est pas possible d’essayer l’application sans compte ici.",
  "GuestScreens.terms":
    "En continuant, vous acceptez les <terms>conditions d’utilisation</terms> et la <privacy>politique de confidentialité</privacy>.",
  "GuestScreens.tryNow": "Essayer maintenant",
  "GuestScreens.tryLine":
    "Aucun compte nécessaire. Ajoutez une méthode de connexion plus tard pour garder votre travail.",
  "GuestScreens.noAccount": "Pas encore de compte ?",
  "GuestScreens.tryWithout": "Essayer sans compte",
  "GuestScreens.tryFromSignIn": "Vous obtiendrez un nouveau compte vide dans ce navigateur.",
  "GuestScreens.tryFromSignInDemo":
    "Vous obtiendrez un nouveau compte avec des données d’exemple pour tester.",
  "GuestScreens.demoWipe":
    "Vous utilisez un compte invité sur une démo publique. Tout est réinitialisé chaque nuit à {time}, même avec une méthode de connexion. Ajoutez-en une quand même pour voir comment fonctionne la conservation d’un compte.",
  "GuestScreens.banner":
    "Ce compte n’existe que dans ce navigateur. Si les données du navigateur sont effacées, il disparaît. Ajoutez une méthode de connexion pour le garder.",
  "GuestScreens.hide": "Masquer ce message",
  "GuestScreens.keptPasskey":
    "Vous pouvez maintenant vous connecter avec une clé d’accès sur n’importe quel appareil. Rien n’a changé dans votre compte.",
  "GuestScreens.keptEmail":
    "Vous pouvez maintenant vous connecter avec votre adresse e-mail sur n’importe quel appareil. Rien n’a changé dans votre compte.",
  "GuestScreens.keptProvider":
    "Vous pouvez maintenant vous connecter avec {provider} sur n’importe quel appareil. Rien n’a changé dans votre compte.",
  "GuestScreens.added": "Méthode de connexion ajoutée",
  "GuestScreens.done": "Terminé",
  "GuestScreens.isKept": "Votre compte est enregistré",
  "GuestScreens.isKeptText":
    "Il a une méthode de connexion : vous pouvez l’ouvrir sur n’importe quel appareil.",
  "GuestScreens.keepText":
    "Ajoutez une méthode de connexion pour ouvrir ce compte sur n’importe quel appareil. Vos notes et vos groupes restent tels quels.",
  "GuestScreens.ways": "Méthodes de connexion",
  "GuestScreens.openingProvider": "Ouverture de {provider}…",
  "GuestScreens.addPasskey": "Ajouter une clé d’accès",
  "GuestScreens.orEmail": "ou utilisez une adresse e-mail et un mot de passe",
  "GuestScreens.email": "Adresse e-mail",
  "GuestScreens.passwordHint": {
    "one": "Au moins {count} caractère.",
    "many": "Au moins {count} caractères.",
    "other": "Au moins {count} caractères.",
  },
  "GuestScreens.saving": "Enregistrement…",
  "GuestScreens.takenProvider": "{provider} est déjà associé à un autre compte.",
  "GuestScreens.takenAddress": "Un compte existe déjà avec cette adresse e-mail.",
  "GuestScreens.takenEmail": "Un compte existe déjà avec <email>{email}</email>.",
  "GuestScreens.takenRest":
    "Votre compte invité n’a pas été modifié. Choisissez quoi faire de ce que vous avez créé en tant qu’invité.",
  "GuestScreens.moveOne":
    "Connectez-vous à ce compte et déplacez-y <name>{name}</name>. Le compte invité sera ensuite supprimé.",
  "GuestScreens.moveMany": {
    "one":
      "Connectez-vous à ce compte et déplacez-y {count} groupe de ce compte invité. Le compte invité sera ensuite supprimé.",
    "many":
      "Connectez-vous à ce compte et déplacez-y {count} groupes de ce compte invité. Le compte invité sera ensuite supprimé.",
    "other":
      "Connectez-vous à ce compte et déplacez-y {count} groupes de ce compte invité. Le compte invité sera ensuite supprimé.",
  },
  "GuestScreens.checking": "Vérification…",
  "GuestScreens.loading": "Chargement…",
  "GuestScreens.nothing": "Rien à choisir ici",
  "GuestScreens.nothingText":
    "Ce choix a expiré ou a déjà été fait. Votre compte invité n’a pas été modifié.",
  "GuestScreens.move": "Changer de compte et déplacer mes groupes",
  "GuestScreens.delete": "Changer de compte et supprimer les données invité",
  "GuestScreens.deleteHint":
    "Connectez-vous à ce compte et supprimez ce compte invité avec tout son contenu.",
  "GuestScreens.keepGuest": "Garder le compte invité",
  "GuestScreens.keepGuestHint":
    "Rien ne change. Vous pouvez ajouter une autre méthode de connexion.",
  "GuestScreens.linked": "Déjà associé à un autre compte",
  "GuestScreens.legend": "Que faire de ce compte invité",
  "GuestScreens.choose": "Choisissez quoi faire de ce que vous avez créé en tant qu’invité.",
  "GuestScreens.passwordOf": "Le mot de passe de {email}.",
  "GuestScreens.passwordOfThat": "Le mot de passe de ce compte.",
  "GuestScreens.otp": "Code de l’application d’authentification de ce compte",
  "GuestScreens.sixDigits": "Six chiffres.",
  "GuestScreens.deleteAndSwitch": "Supprimer et changer de compte",
  "GuestScreens.notes": {
    "one": "{count} note",
    "many": "{count} notes",
    "other": "{count} notes",
  },
  "GuestScreens.groups": {
    "one": "{count} groupe",
    "many": "{count} groupes",
    "other": "{count} groupes",
  },
  "GuestScreens.confirmEmail":
    "Cette action supprime ses {notes} et ses {groups}, puis vous connecte à <email>{email}</email>. Elle est irréversible.",
  "GuestScreens.confirmAccount":
    "Cette action supprime ses {notes} et ses {groups}, puis vous connecte à ce compte. Elle est irréversible.",
  "GuestScreens.signOutTitle": "Se déconnecter d’un compte invité ?",
  "GuestScreens.signOutAnyway": "Se déconnecter quand même",
  "GuestScreens.signOutText":
    "Ce compte n’a aucune méthode de connexion : vous ne pourrez pas vous reconnecter. Vous perdrez tout son contenu.",
  "GuestScreens.offline": "Vous êtes hors ligne. Connectez-vous à Internet et réessayez.",
  "GuestScreens.providerFailed":
    "{provider} n’a pas abouti. Votre compte n’a pas été modifié. Réessayez ou choisissez une autre méthode.",
  "GuestScreens.noPasskey":
    "Aucune clé d’accès n’a été ajoutée. Votre compte reste un compte invité.",
  "GuestScreens.didNotWork": "Cela n’a pas fonctionné. Réessayez.",
  "OAuthNotice.failed": "Cette connexion n’a pas fonctionné. Réessayez.",
  "OAuthNotice.linked": "Associé. Vous pouvez maintenant l’utiliser pour vous connecter.",
  "OAuthNotice.linkExists":
    "Déjà associé. Vous pouvez l’utiliser pour vous connecter, comme avant.",
  "OAuthNotice.linkTaken": "Non associé : ce compte est déjà associé à un autre compte ici.",
  "OAuthNotice.busy": "Trop de tentatives. Patientez une minute, puis réessayez.",
  "OAuthNotice.kept":
    "Méthode de connexion ajoutée. Vous pouvez maintenant l’utiliser sur n’importe quel appareil.",
  "OAuthNotice.guestTaken": "Cette méthode de connexion appartient à un autre compte.",
  "PasswordResetScreen.forgotFailed": "Impossible d’envoyer le lien",
  "PasswordResetScreen.resetFailed": "Impossible de changer le mot de passe",
  "PasswordResetScreen.sent":
    "Si un compte utilise cette adresse e-mail, nous lui avons envoyé un lien pour réinitialiser le mot de passe.",
  "PasswordResetScreen.forgotDescription": {
    "one":
      "Saisissez l’adresse e-mail utilisée lors de l’inscription. Nous vous enverrons un lien pour choisir un nouveau mot de passe. Il fonctionne une seule fois, pendant {count} minute.",
    "many":
      "Saisissez l’adresse e-mail utilisée lors de l’inscription. Nous vous enverrons un lien pour choisir un nouveau mot de passe. Il fonctionne une seule fois, pendant {count} minutes.",
    "other":
      "Saisissez l’adresse e-mail utilisée lors de l’inscription. Nous vous enverrons un lien pour choisir un nouveau mot de passe. Il fonctionne une seule fois, pendant {count} minutes.",
  },
  "PasswordResetScreen.remembered": "Vous vous en souvenez ? <link>Retour à la connexion</link>",
  "PasswordResetScreen.send": "Envoyer le lien",
  "PasswordResetScreen.doneTitle": "Mot de passe modifié",
  "PasswordResetScreen.done":
    "Vous avez été déconnecté partout. Connectez-vous avec votre nouveau mot de passe.",
  "PasswordResetScreen.signIn": "Se connecter",
  "PasswordResetScreen.askNew": "Demander un nouveau lien",
  "PasswordResetScreen.chooseTitle": "Choisissez un nouveau mot de passe",
  "PasswordResetScreen.choose":
    "Pour <email>{email}</email>. L’enregistrer vous déconnecte sur tous vos appareils.",
  "PasswordResetScreen.expired": "Lien expiré ? <link>Demandez-en un nouveau</link>",
  "PasswordResetScreen.newPassword": "Nouveau mot de passe",
  "PasswordResetScreen.newPasswordHint": "De {min} à {max} caractères.",
  "PasswordResetScreen.saving": "Enregistrement…",
  "PasswordResetScreen.save": "Enregistrer le mot de passe",
  "MoveNote.title": "Déplacer vers un groupe",
  "MoveNote.cancel": "Annuler",
  "MoveNote.question":
    "Choisissez où déplacer « <title>{title}</title> ». Tous les membres de ce groupe la verront.",
  "NewNote.title": "Nouvelle note",
  "NewNote.close": "Fermer",
  "NewNote.titleLabel": "Titre",
  "NewNote.groupLabel": "Groupe",
  "NewNote.chooseGroup": "Choisir un groupe",
  "NewNote.chooseGroupError": "Choisissez un groupe pour cette note.",
  "NewNote.inGroup": "Dans {group}",
  "NewNote.noGroup":
    "Il vous faut un groupe dans lequel vous pouvez écrire. Créez-en un pour commencer.",
  "NewNote.newGroup": "Nouveau groupe",
  "NewNote.add": "Ajouter la note",
  "NewNote.adding": "Ajout…",
  "NewNote.open": "Ouvrir la note",
  "NewNote.keys": "<add>Enter</add> ajoute · <open>Ctrl Enter</open> ajoute et ouvre",
  "NewNote.added": "« <title>{title}</title> » ajoutée à <group>{group}</group>.",
  "NewNote.onDevice":
    "Enregistrée sur cet appareil. Elle sera synchronisée dès votre retour en ligne.",
  "NoGroup.loading": "Chargement du groupe…",
  "NoGroup.title": "Ce groupe n’existe pas.",
  "NoGroup.back": "Retour aux groupes",
  "NoteAttachments.title": "Pièces jointes",
  "NoteAttachments.count": "{count} sur {max}",
  "NoteAttachments.attach": "Joindre des fichiers",
  "NoteAttachments.empty": "Déposez des images ou des PDF ici, ou choisissez des fichiers.",
  "NoteAttachments.types": "JPEG, PNG, WebP, GIF ou PDF, jusqu’à {size} chacun.",
  "NoteAttachments.waitingCreate": "Sera importé à la création de la note",
  "NoteAttachments.almostFull": "Presque plein.",
  "NoteAttachments.quota": {
    "one": "<group>{group}</group> utilise {files} fichier sur {count} et {bytes} sur {maxBytes}.",
    "many":
      "<group>{group}</group> utilise {files} fichiers sur {count} et {bytes} sur {maxBytes}.",
    "other":
      "<group>{group}</group> utilise {files} fichiers sur {count} et {bytes} sur {maxBytes}.",
  },
  "NoteAttachments.quotaNoByteCap": {
    "one": "<group>{group}</group> utilise {files} fichier sur {count} et {bytes}.",
    "many": "<group>{group}</group> utilise {files} fichiers sur {count} et {bytes}.",
    "other": "<group>{group}</group> utilise {files} fichiers sur {count} et {bytes}.",
  },
  "NoteAttachments.quotaNoFileCap": {
    "one": "<group>{group}</group> utilise {count} fichier et {bytes} sur {maxBytes}.",
    "many": "<group>{group}</group> utilise {count} fichiers et {bytes} sur {maxBytes}.",
    "other": "<group>{group}</group> utilise {count} fichiers et {bytes} sur {maxBytes}.",
  },
  "NoteAttachments.quotaNoCaps": {
    "one": "<group>{group}</group> utilise {count} fichier et {bytes}.",
    "many": "<group>{group}</group> utilise {count} fichiers et {bytes}.",
    "other": "<group>{group}</group> utilise {count} fichiers et {bytes}.",
  },
  "NoteAttachments.removeTitle": "Retirer ce fichier ?",
  "NoteAttachments.removeMessage":
    "« {name} » sera retiré de cette note pour tous les membres de {group}.",
  "NoteAttachments.removeConfirm": "Retirer le fichier",
  "NoteAttachments.cancel": "Annuler",
  "NoteEditor.title": "Note",
  "NoteEditor.back": "Retour aux notes",
  "NoteEditor.elsewhereTitle": "Note dans un autre groupe",
  "NoteEditor.elsewhere":
    "Cette note se trouve dans <group>{group}</group>, l’un de vos autres groupes. Vous êtes actuellement dans <current>{current}</current>.",
  "NoteEditor.switching": "Changement…",
  "NoteEditor.switchTo": "Passer à <group>{group}</group>",
  "NoteEditor.notFoundTitle": "Cette note n’existe pas.",
  "NoteEditor.notFound":
    "Impossible de trouver cette note dans <group>{group}</group>. Elle a peut-être été supprimée, ou elle se trouve dans un autre de vos groupes : passez à ce groupe et ouvrez-la depuis celui-ci.",
  "NoteEditor.loading": "Chargement de la note…",
  "NoteEditor.createdBy": "Créée par <name>{name}</name>, <date>{date}</date>",
  "NoteEditor.created": "Créée, <date>{date}</date>",
  "NoteEditor.updatedBy": "Modifiée par <name>{name}</name>, <date>{date}</date>",
  "NoteEditor.updated": "Modifiée, <date>{date}</date>",
  "NoteEditor.new": "Nouvelle note",
  "NoteEditor.readOnly":
    "Vous pouvez consulter cette note, mais seuls les éditeurs peuvent la modifier.",
  "NoteEditor.readOnlyNew": "Seuls les éditeurs peuvent ajouter des notes à ce groupe.",
  "NoteEditor.titleLabel": "Titre",
  "NoteEditor.conflict":
    "<link>Chargez la dernière version</link> pour voir ce qui a changé. Votre texte est conservé ici jusque-là.",
  "NoteEditor.cancel": "Annuler",
  "NoteEditor.saving": "Enregistrement…",
  "NoteEditor.creating": "Création…",
  "NoteEditor.save": "Enregistrer la note",
  "NoteEditor.create": "Ajouter la note",
  "NoteEditor.deleteTitle": "Supprimer cette note ?",
  "NoteEditor.deleteMessage": "« {title} » sera supprimée pour tous les membres de {group}.",
  "NoteEditor.deleteConfirm": "Supprimer la note",
  "NoteEditor.text": "Texte",
  "NoteEditor.tags": "Étiquettes",
  "NoteEditorView.createdTitle": "Note ajoutée",
  "NoteEditorView.created": "« {title} » a été créée.",
  "NoteEditorView.savedTitle": "Note enregistrée",
  "NoteEditorView.saved": "« {title} » a été enregistrée.",
  "NoteEditorView.unsaved":
    "Vous avez des modifications non enregistrées. Si vous partez maintenant, vous les perdrez.",
  "NoteMessages.titleRequired": "Saisissez un titre.",
  "NoteMessages.conflict": "Quelqu’un a modifié cette note depuis que vous l’avez ouverte.",
  "NoteMessages.deleteConflict":
    "Quelqu’un a modifié cette note : elle n’a donc pas été supprimée.",
  "NoteMessages.gone": "Cette note a été supprimée.",
  "NoteMessages.load": "Impossible de charger les notes",
  "NoteMessages.create": "Impossible de créer la note. Réessayez.",
  "NoteMessages.save": "Impossible d’enregistrer la note",
  "NoteMessages.delete": "Impossible de supprimer la note",
  "NoteMessages.move": "Impossible de déplacer les notes",
  "NoteMessages.moveOffline":
    "Il vous faut une connexion pour déplacer des notes. Réessayez une fois de retour en ligne.",
  "NoteMessages.moveNone": "Sélectionnez les notes à déplacer.",
  "NoteMessages.moveUnsaved":
    "Enregistrez ou abandonnez vos modifications avant de déplacer la note.",
  "NoteMessages.restore": "Impossible de restaurer la note",
  "NoteMessages.restoreOffline":
    "Il vous faut une connexion pour restaurer une note. Réessayez une fois de retour en ligne.",
  "NoteMessages.restoreGone": "Cette note ne fait plus partie des notes supprimées.",
  "NoteMessages.moveGone": "Une note sélectionnée n’est plus là : rien n’a donc été déplacé.",
  "NotePeople.you": "Vous",
  "NotePeople.former": "Ancien membre",
  "NotePeople.unnamed": "Membre sans nom",
  "NoteSync.gone":
    "Cette note a été supprimée, ou déplacée vers un autre groupe, pendant que vous étiez hors ligne.",
  "NoteSync.version": "Quelqu’un a modifié cette note pendant que vous étiez hors ligne.",
  "NotFound.title": "Page introuvable",
  "NotFound.description":
    "Cette adresse ne mène à aucune page. Elle contient peut-être une faute de frappe, ou la page a été déplacée.",
  "NotFound.signedOut":
    "Cette adresse ne mène à aucune page. Connectez-vous pour accéder à vos notes.",
  "NotFound.toNotes": "Accéder à vos notes",
  "NotFound.signIn": "Se connecter",
  "Notes.title": "Notes",
  "Notes.new": "Nouvelle note",
  "Notes.count": {
    "one": "{count} note",
    "many": "{count} notes",
    "other": "{count} notes",
  },
  "Notes.deleted": "Supprimée <date>{date}</date>",
  "Notes.restoreNote": "Restaurer {title}",
  "Notes.restoring": "Restauration…",
  "Notes.restore": "Restaurer",
  "Notes.noMatch": "Aucune note ne correspond à « {query} »",
  "Notes.noMatchHint": "Vérifiez l’orthographe ou essayez avec moins de mots.",
  "Notes.clearSearch": "Effacer la recherche",
  "Notes.noFilterMatch": "Aucune note ne correspond à ces filtres",
  "Notes.noFilterMatchHint": "Essayez avec moins d’étiquettes ou un autre auteur.",
  "Notes.clearFilters": "Effacer les filtres",
  "Notes.showLive": "Afficher les notes",
  "Notes.showDeleted": "Afficher les notes supprimées",
  "Notes.select": "Sélectionner des notes",
  "Notes.manageTags": "Gérer les étiquettes",
  "Notes.readOnly":
    "Vous pouvez consulter ces notes, mais seuls les éditeurs peuvent les modifier.",
  "Notes.deletedBanner": {
    "one":
      "Les notes supprimées restent ici pendant {count} jour, puis elles sont effacées définitivement.",
    "many":
      "Les notes supprimées restent ici pendant {count} jours, puis elles sont effacées définitivement.",
    "other":
      "Les notes supprimées restent ici pendant {count} jours, puis elles sont effacées définitivement.",
  },
  "Notes.backToNotes": "Retour aux notes",
  "Notes.deletedLoading": "Chargement des notes supprimées…",
  "Notes.deletedEmpty": "Aucune note supprimée",
  "Notes.loading": "Chargement des notes…",
  "Notes.empty": "Aucune note pour l’instant",
  "Notes.emptyHint":
    "Les notes que vous écrivez ici sont partagées avec tous les membres de {group}.",
  "Notes.tickToMove": "Sélectionnez les notes à déplacer",
  "Notes.selected": {
    "one": "{count} sélectionnée",
    "many": "{count} sélectionnées",
    "other": "{count} sélectionnées",
  },
  "Notes.cancelSelect": "Annuler",
  "Notes.moveTo": "Déplacer vers un groupe",
  "Notes.moving": "Déplacement…",
  "Notes.move": "Déplacer",
  "Notes.updated": "Modifiée <date>{date}</date>",
  "Notes.created": "Créée <date>{date}</date>",
  "Notes.tick": "Sélectionner {title}",
  "Notes.actions": "Actions pour {title}",
  "Notes.open": "Ouvrir",
  "Notes.moveToGroup": "Déplacer vers un groupe…",
  "Notes.copyLink": "Copier le lien",
  "Notes.delete": "Supprimer",
  "NotesFilter.tags": "Étiquettes",
  "NotesFilter.tag": "Étiquette",
  "NotesFilter.showWith": "Afficher les notes avec",
  "NotesFilter.anyTag": "Au moins une de ces étiquettes",
  "NotesFilter.allTags": "Toutes ces étiquettes",
  "NotesFilter.author": "Auteur",
  "NotesFilter.anyone": "Tout le monde",
  "NotesFilter.you": "Vous",
  "NotesFilter.search": "Rechercher dans les notes",
  "NotesFilter.mine": "Créées par moi",
  "NotesFilter.sortUpdated": "Dernière modification",
  "NotesFilter.sortCreated": "Date de création",
  "NotesFilter.sortTitle": "Titre",
  "NotesFilter.newestFirst": "Plus récentes d’abord",
  "NotesFilter.oldestFirst": "Plus anciennes d’abord",
  "NotesFilter.aToZ": "A–Z",
  "NotesFilter.zToA": "Z–A",
  "NotesView.linkCopied": "Lien copié",
  "NotesView.linkCopiedGroup": "Seuls les membres de {group} peuvent l’ouvrir.",
  "NotesView.linkCopiedThisGroup": "Seuls les membres de ce groupe peuvent l’ouvrir.",
  "NotesView.copyFailed": "Impossible de copier le lien",
  "NotesView.copyFailedHint":
    "Votre navigateur l’a bloqué. Ouvrez la note et copiez le lien depuis la barre d’adresse.",
  "NotesView.restoredTitle": "Note restaurée",
  "NotesView.restored": "« {title} » est de retour dans la liste.",
  "NotesView.restoredUntitled": "La note est de retour dans la liste.",
  "NoteToasts.movedTitle": {
    "one": "Note déplacée",
    "many": "Notes déplacées",
    "other": "Notes déplacées",
  },
  "NoteToasts.moved": {
    "one": "La note a été déplacée vers {group}.",
    "many": "{count} notes ont été déplacées vers {group}.",
    "other": "{count} notes ont été déplacées vers {group}.",
  },
  "NoteToasts.movedElsewhere": {
    "one": "La note a été déplacée vers l’autre groupe.",
    "many": "{count} notes ont été déplacées vers l’autre groupe.",
    "other": "{count} notes ont été déplacées vers l’autre groupe.",
  },
  "NoteWidgets.previousPeriod": {
    "one": "jour précédent",
    "many": "{count} jours précédents",
    "other": "{count} jours précédents",
  },
  "NoteWidgets.totalTitle": "Notes",
  "NoteWidgets.totalLoading": "Chargement du nombre de notes",
  "NoteWidgets.totalError":
    "Impossible de charger le nombre de notes. Vérifiez votre connexion et réessayez.",
  "NoteWidgets.totalNow": "Dans le groupe actuellement",
  "NoteWidgets.totalOn": "Le {date}",
  "NoteWidgets.addedTitle": "Notes ajoutées",
  "NoteWidgets.addedLoading": "Chargement des notes ajoutées",
  "NoteWidgets.addedError":
    "Impossible de charger les notes ajoutées. Vérifiez votre connexion et réessayez.",
  "NoteWidgets.addedNone": "Aucun ajout sur cette période",
  "NoteWidgets.addedSome": "Ajoutées sur cette période",
  "NoteWidgets.seriesTitle": "Évolution des notes",
  "NoteWidgets.seriesLoading": "Chargement du graphique",
  "NoteWidgets.seriesError":
    "Impossible de charger le graphique. Vérifiez votre connexion et réessayez.",
  "NoteWidgets.seriesEmpty": "Aucune note sur cette période",
  "NoteWidgets.seriesFlat": "{value} sur toute la période",
  "NoteWidgets.seriesFrom": "De {first} à {last}",
  "NoteWidgets.seriesCurrent": "Cette période",
  "NoteWidgets.seriesPrevious": {
    "one": "La veille",
    "many": "Les {count} jours précédents",
    "other": "Les {count} jours précédents",
  },
  "NoteWidgets.seriesLabel": "Évolution des notes. {summary}.",
  "NoteWidgets.seriesDay": "Jour",
  "OfflineStatus.copied": "Copié.",
  "OfflineStatus.copy": "Copier mon texte",
  "OfflineStatus.copyFailed":
    "Impossible de copier. Sélectionnez le texte ci-dessus et copiez-le vous-même.",
  "OfflineStatus.deletedNote": "Note supprimée",
  "OfflineStatus.deletedTag": "Étiquette supprimée",
  "OfflineStatus.dismiss": "Fermer",
  "OfflineStatus.held": {
    "one": "Une note attend votre décision au sujet d’une étiquette ci-dessous. Rien n’est perdu.",
    "many":
      "{count} notes attendent votre décision au sujet d’une étiquette ci-dessous. Rien n’est perdu.",
    "other":
      "{count} notes attendent votre décision au sujet d’une étiquette ci-dessous. Rien n’est perdu.",
  },
  "OfflineStatus.mine": "Votre version",
  "OfflineStatus.noteGone": "La note ne fait plus partie de ce groupe.",
  "OfflineStatus.sync": "Synchroniser",
  "OfflineStatus.tag": "Étiquette {name}",
  "OfflineStatus.tagGone": "L’étiquette ne fait plus partie de ce groupe.",
  "OfflineStatus.tagNoName": "Étiquette sans nom",
  "OfflineStatus.tagTakenOff": {
    "one":
      "Une étiquette créée hors ligne n’a pas pu être enregistrée : nous l’avons donc retirée de {count} note. La note est enregistrée sans elle.",
    "many":
      "Une étiquette créée hors ligne n’a pas pu être enregistrée : nous l’avons donc retirée de {count} notes. Les notes sont enregistrées sans elle.",
    "other":
      "Une étiquette créée hors ligne n’a pas pu être enregistrée : nous l’avons donc retirée de {count} notes. Les notes sont enregistrées sans elle.",
  },
  "OfflineStatus.theirs": "Version du serveur",
  "OfflineStatus.theirsUnknown": "La version du serveur n’est pas disponible.",
  "OfflineStatus.untitledNote": "Note sans titre",
  "OfflineStatus.useServers": "Utiliser celle du serveur",
  "OfflineStatus.youDeletedNote": "Vous avez supprimé cette note.",
  "OfflineStatus.youDeletedTag": "Vous avez supprimé cette étiquette.",
  "Preferences.example": "Les dates et heures s’affichent ainsi : <value>{date}</value>.",
  "Preferences.conflict":
    "Un autre appareil vient de les modifier. Vous voyez maintenant les valeurs qu’il a enregistrées.",
  "Preferences.language": "Langue",
  "Preferences.changeLanguage": "Changer de langue",
  "Preferences.formats": "Formats",
  "Preferences.formatsHint":
    "L’affichage des dates, des heures et des nombres. Cela ne change pas la langue.",
  "Preferences.formatsPlaceholder": "Rechercher par langue ou par pays",
  "Preferences.formatsEmpty": "Aucun format ne correspond à « {query} ».",
  "Preferences.automatic": "Automatique : {value}",
  "Preferences.automaticSearch": "appareil automatique",
  "Preferences.timeZone": "Fuseau horaire",
  "Preferences.timeZoneHint":
    "Le fuseau horaire choisi s’applique sur tous vos appareils. Automatique utilise celui de chaque appareil.",
  "Preferences.timeZonePlaceholder": "Rechercher par ville",
  "Preferences.timeZoneEmpty":
    "Aucun fuseau horaire ne correspond à « {query} ». Essayez une ville ou un décalage comme GMT+2.",
  "Preferences.clock": "Horloge",
  "Preferences.clockFromFormat": "Selon le format ({clock})",
  "Preferences.clock12": "12 heures",
  "Preferences.clock24": "24 heures",
  "Preferences.deviceZone": "Cet appareil est à l’heure de {city} ({offset}).",
  "Preferences.useZone": "Utiliser l’heure de {city}",
  "Preferences.keepZone": "Garder l’heure de {city}",
  "Preferences.theme": "Thème",
  "Preferences.themeSystem": "Système",
  "Preferences.themeLight": "Clair",
  "Preferences.themeDark": "Sombre",
  "Preferences.themeSystemLight": "Système (clair sur cet appareil)",
  "Preferences.themeSystemDark": "Système (sombre sur cet appareil)",
  "Preferences.failedNetwork":
    "Impossible d’enregistrer votre modification. Vérifiez votre connexion et réessayez.",
  "Preferences.failedOffline":
    "Vous êtes hors ligne : rien n’a été enregistré. Réessayez une fois de retour en ligne.",
  "Preferences.failedInvalid": "Choisissez chaque valeur dans sa liste.",
  "Preferences.updatedElsewhere": "Préférences mises à jour depuis un autre appareil.",
  "SeatPriceConfirm.hint":
    "Chaque nouveau membre ajoute {price} par mois : un membre de plus fait passer le groupe de {now} à {next}. La différence pour le reste de la période sera facturée sur la prochaine facture.",
  "SeatPriceConfirm.accept":
    "J’accepte le prix plus élevé pour chaque personne qui rejoint le groupe",
  "ProfileAccount.name": "Nom",
  "ProfileAccount.notSet": "Non renseigné",
  "ProfileAccount.editName": "Modifier<hidden> le nom</hidden>",
  "ProfileAccount.email": "Adresse e-mail",
  "ProfileAccount.enterCode": "Saisir le code",
  "ProfileAccount.addEmail": "Ajouter<hidden> une adresse e-mail</hidden>",
  "ProfileAccount.changeEmail": "Modifier<hidden> l’adresse e-mail</hidden>",
  "ProfileAccount.editTitle": "Modifier le nom",
  "ProfileAccount.firstName": "Prénom",
  "ProfileAccount.lastName": "Nom",
  "ProfileAccount.save": "Enregistrer",
  "ProfileAccount.noneUsername": "Aucune. Vous vous connectez avec votre nom d’utilisateur.",
  "ProfileAccount.none": "Aucune.",
  "ProfileAccount.noneProvider": "Aucune. {provider} n’a pas partagé d’adresse e-mail vérifiée.",
  "ProfileExport.asking": "Demande en cours…",
  "ProfileExport.never":
    "Un fichier ZIP contenant votre profil, vos groupes et vos notes aux formats JSON et CSV. Cela prend quelques minutes, et nous vous enverrons un e-mail quand il sera prêt.",
  "ProfileExport.download": "Télécharger mes données",
  "ProfileExport.preparing":
    "Préparation de votre fichier. Nous vous enverrons un e-mail et une notification quand il sera prêt.",
  "ProfileExport.ready":
    "<hidden>Votre fichier est prêt. </hidden>Prêt : {size}, jusqu’au <day></day>.",
  "ProfileExport.changed":
    "Vous avez modifié quelque chose depuis ? <button>Préparer un nouveau fichier.</button>",
  "ProfileExport.downloadZip": "Télécharger le ZIP",
  "ProfileExport.expired": "Votre dernier fichier a expiré le <day></day>.",
  "ProfileExport.prepareNew": "Préparer un nouveau fichier",
  "ProfileExport.failed": "Impossible de préparer votre fichier. Réessayez.",
  "ProfileExport.label": "Vos données",
  "ProfileExport.network":
    "Impossible de demander votre fichier. Vérifiez votre connexion et réessayez.",
  "ProfileExport.tooSoonToday":
    "Vous pouvez demander un fichier par jour. Réessayez aujourd’hui après {time}.",
  "ProfileExport.tooSoonTomorrow":
    "Vous pouvez demander un fichier par jour. Réessayez demain après {time}.",
  "ProfileNotifications.emptyTitle": "Aucun appareil pour l’instant",
  "ProfileNotifications.emptyText": "Ajoutez ce navigateur pour y recevoir des notifications.",
  "ProfileNotifications.device": "Appareil {id}",
  "ProfileNotifications.added": "Ajouté {date}",
  "ProfileNotifications.remove": "Retirer<hidden> l’appareil {id}</hidden>",
  "ProfileNotifications.working": "En cours…",
  "ProfileNotifications.add": "Ajouter cet appareil",
  "ProfilePicture.network":
    "Impossible d’importer votre photo. Vérifiez votre connexion et réessayez.",
  "ProfilePicture.offline":
    "Vous êtes hors ligne. Importez votre photo une fois de retour en ligne.",
  "ProfilePicture.removeFailed":
    "Impossible de retirer votre photo. Vérifiez votre connexion et réessayez.",
  "ProfilePicture.type":
    "{name} n’est pas une image JPEG, PNG, WebP ou HEIC. Choisissez l’un de ces formats.",
  "ProfilePicture.size": "{name} pèse {size}. Choisissez une image de {max} maximum.",
  "ProfilePicture.content":
    "{name} n’est pas vraiment une image : nous ne l’avons donc pas utilisée. Choisissez un autre fichier.",
  "ProfilePicture.pending": "Attendez la fin des importations en cours, puis réessayez.",
  "ProfilePicture.budget":
    "Vous avez atteint la limite d’importations par heure. Réessayez plus tard.",
  "ProfilePicture.saved": "Photo de profil enregistrée.",
  "ProfilePicture.removed": "Photo de profil retirée.",
  "ProfilePicture.preparing": "Préparation de votre photo…",
  "ProfilePicture.refused": "Impossible d’utiliser cette photo. Choisissez-en une autre.",
  "ProfilePicture.label": "Photo de profil",
  "ProfilePicture.rule": "JPEG, PNG, WebP ou HEIC, jusqu’à {max}.",
  "ProfilePicture.changeHidden": "Changer<hidden> de photo de profil</hidden>",
  "ProfilePicture.uploadHidden": "Importer<hidden> une photo de profil</hidden>",
  "ProfilePicture.uploading": "Importation…",
  "ProfilePicture.removeHidden": "Retirer<hidden> la photo de profil</hidden>",
  "ProfilePicture.removeTitle": "Retirer votre photo de profil ?",
  "ProfilePicture.removeText":
    "Vos initiales s’affichent à la place, ici et dans tous vos groupes.",
  "ProfilePicture.removeButton": "Retirer la photo",
  "ProfileScreen.profileFailed":
    "Impossible d’enregistrer votre nom. Vérifiez votre connexion et réessayez.",
  "ProfileScreen.passwordFailed":
    "Impossible de changer votre mot de passe. Vérifiez votre connexion et réessayez.",
  "ProfileScreen.passwordSetFailed":
    "Impossible de définir votre mot de passe. Vérifiez votre connexion et réessayez.",
  "ProfileScreen.totpFinishFailed":
    "Impossible d’activer la double authentification. Vérifiez le code dans votre application et réessayez.",
  "ProfileScreen.totpDisableFailed":
    "Impossible de désactiver la double authentification. Vérifiez votre connexion et réessayez.",
  "ProfileScreen.pushFailed":
    "Impossible d’ajouter cet appareil. Autorisez les notifications pour ce site dans votre navigateur, puis réessayez.",
  "ProfileScreen.pushRemoveFailed":
    "Impossible de retirer cet appareil. Vérifiez votre connexion et réessayez.",
  "ProfileScreen.account": "Compte",
  "ProfileScreen.accountText":
    "Votre photo, votre nom, votre adresse e-mail et une copie de vos données.",
  "ProfileScreen.security": "Connexion et sécurité",
  "ProfileScreen.securityText": "Comment vous vous connectez, et où votre compte est connecté.",
  "ProfileScreen.region": "Langue et région",
  "ProfileScreen.regionText": "Votre langue, et l’affichage des dates, des heures et des nombres.",
  "ProfileScreen.appearance": "Apparence",
  "ProfileScreen.appearanceText": "L’apparence de l’application sur cet appareil.",
  "ProfileScreen.notifications": "Notifications",
  "ProfileScreen.notificationsText":
    "Où vous prévenir quand quelque chose change dans vos groupes.",
  "ProfileScreen.apiTokens": "Jetons d’API",
  "ProfileScreen.apiTokensText":
    "Permettez à un script ou à un autre service d’utiliser l’un de vos groupes sans votre mot de passe.",
  "ProfileScreen.dangerZone": "Supprimer le compte",
  "ProfileScreen.dangerZoneText": "Supprimez votre compte et tout ce que vous seul pouvez voir.",
  "ProfileScreen.codeTitle": "Saisissez votre code à usage unique",
  "ProfileScreen.codeText":
    "Saisissez le code de votre application d’authentification pour ouvrir votre profil.",
  "ProfileScreen.signInTitle": "Connectez-vous pour voir votre profil",
  "ProfileScreen.signInText":
    "Connectez-vous pour voir votre nom, votre mot de passe et vos appareils.",
  "ProfileScreen.createAccount": "Créer un compte",
  "ProfileScreen.twoFactorOn": "Double authentification activée",
  "ProfileScreen.twoFactorOff": "Double authentification désactivée",
  "ProfileScreen.title": "Profil",
  "ProfileScreen.noName": "Sans nom",
  "ProfileScreen.push": "Notifications push",
  "ProfileScreen.pushText":
    "Recevez des notifications sur vos navigateurs et vos téléphones, même quand l’application est fermée.",
  "ProfileScreen.passkeys": {
    "one": "une clé d’accès",
    "many": "des clés d’accès",
    "other": "des clés d’accès",
  },
  "ProfileSecurity.setPasswordHidden": "Définir<hidden> un mot de passe</hidden>",
  "ProfileSecurity.changePasswordHidden": "Changer<hidden> de mot de passe</hidden>",
  "ProfileSecurity.noPassword": "Aucun. Vous vous connectez avec {names}.",
  "ProfileSecurity.passwordAsked": "Demandé lorsque vous vous connectez sur un nouvel appareil.",
  "ProfileSecurity.twoFactor": "Double authentification",
  "ProfileSecurity.twoFactorText":
    "La connexion demande aussi un code d’une application d’authentification : un mot de passe divulgué ne suffit donc pas.",
  "ProfileSecurity.app": "Application d’authentification",
  "ProfileSecurity.on": "Activée",
  "ProfileSecurity.onText": "La connexion demande un code, sauf si vous utilisez une clé d’accès.",
  "ProfileSecurity.off": "Désactivée",
  "ProfileSecurity.turnOffHidden": "Désactiver<hidden> la double authentification</hidden>",
  "ProfileSecurity.turnOnHidden": "Activer<hidden> la double authentification</hidden>",
  "ProfileSecurity.setTitle": "Définir un mot de passe",
  "ProfileSecurity.changeTitle": "Changer de mot de passe",
  "ProfileSecurity.setText":
    "Ajoutez un mot de passe pour pouvoir aussi vous connecter avec votre adresse e-mail.",
  "ProfileSecurity.setNeedsEmail":
    "Vous vous connectez avec un mot de passe et votre adresse e-mail, et ce compte n’a pas encore d’adresse e-mail. Ajoutez-en d’abord une, puis revenez ici pour définir un mot de passe.",
  "ProfileSecurity.setNeedsCode":
    "Vous vous connectez avec un mot de passe et votre adresse e-mail. Confirmez d’abord <email>{email}</email> avec le code que nous y avons envoyé, puis revenez ici pour définir un mot de passe.",
  "ProfileSecurity.addEmail": "Ajouter une adresse e-mail",
  "ProfileSecurity.codeFromAuthenticator": "Code de votre application d’authentification",
  "ProfileSecurity.updating": "Mise à jour…",
  "ProfileSecurity.setButton": "Définir le mot de passe",
  "ProfileSecurity.turnOnTitle": "Activer la double authentification",
  "ProfileSecurity.turnOnText":
    "Une fois activée, la connexion demande aussi un code de votre application d’authentification, et vos autres appareils sont déconnectés.",
  "ProfileSecurity.turnOnPassword":
    "Une fois activée, la connexion demande aussi un code de votre application d’authentification, et vos autres appareils sont déconnectés. Saisissez votre mot de passe pour confirmer qu’il s’agit bien de vous.",
  "ProfileSecurity.preparing": "Préparation…",
  "ProfileSecurity.scan":
    "Scannez le code avec votre application d’authentification, puis saisissez les six chiffres qu’elle affiche.",
  "ProfileSecurity.qr": "QR code pour votre application d’authentification",
  "ProfileSecurity.key": "Impossible de le scanner ? Saisissez cette clé : <key>{key}</key>",
  "ProfileSecurity.codeFromApp": "Code de votre application",
  "ProfileSecurity.turningOn": "Activation…",
  "ProfileSecurity.turnOn": "Activer",
  "ProfileSecurity.turnOffTitle": "Désactiver la double authentification ?",
  "ProfileSecurity.turnOffCode":
    "La connexion ne demandera plus de code. Saisissez un code de votre application d’authentification pour confirmer qu’il s’agit bien de vous. Vous pourrez réactiver la double authentification à tout moment.",
  "ProfileSecurity.turnOffPassword":
    "La connexion ne demandera plus que votre mot de passe. Saisissez votre mot de passe pour confirmer qu’il s’agit bien de vous. Vous pourrez réactiver la double authentification à tout moment.",
  "ProfileSecurity.turningOff": "Désactivation…",
  "ProfileSecurity.turnOff": "Désactiver",
  "ProfileTelegram.title": "Telegram",
  "ProfileTelegram.statusFailed":
    "Impossible de charger votre association Telegram. Vérifiez votre connexion et réessayez.",
  "ProfileTelegram.codeFailed":
    "Impossible de créer un code d’association. Vérifiez votre connexion et réessayez.",
  "ProfileTelegram.unlinkFailed":
    "Impossible de dissocier Telegram. Vérifiez votre connexion et réessayez.",
  "ProfileTelegram.theBot": "le bot",
  "ProfileTelegram.description":
    "Recevez vos notifications dans une conversation avec {bot}, et utilisez-y ses commandes.",
  "ProfileTelegram.chat": "Conversation",
  "ProfileTelegram.linked": "Associé le <day></day>",
  "ProfileTelegram.notLinked": "Non associé",
  "ProfileTelegram.unlinkHidden": "Dissocier<hidden> Telegram</hidden>",
  "ProfileTelegram.link": "Associer Telegram",
  "ProfileTelegram.unlinkTitle": "Dissocier Telegram ?",
  "ProfileTelegram.unlinkText":
    "Les notifications ne seront plus envoyées sur Telegram, et {bot} ne pourra plus agir en votre nom. Pour l’associer à nouveau, il vous faudra un nouveau code.",
  "ProfileTelegram.open":
    "Ouvrez la conversation avec <strong>{bot}</strong> et appuyez sur Démarrer, puis sur {button}. Cette fenêtre se ferme dès que votre compte est associé.",
  "ProfileTelegram.openButton": "Ouvrir Telegram",
  "ProfileTelegram.elsewhere": "Telegram sur un autre appareil ? Envoyez ce message à {bot} :",
  "ProfileTelegram.message": "Message à envoyer",
  "ProfileTelegram.copy": "Copier le message",
  "ProfileTelegram.copied": "Message copié",
  "ProfileTelegram.waiting": {
    "one": "En attente de Telegram… Le code fonctionne une seule fois, pendant {count} minute.",
    "many": "En attente de Telegram… Le code fonctionne une seule fois, pendant {count} minutes.",
    "other": "En attente de Telegram… Le code fonctionne une seule fois, pendant {count} minutes.",
  },
  "ProfileView.codeMissing": "Saisissez le code de votre application d’authentification",
  "ProfileView.telegramLinked": "Telegram associé",
  "ProfileView.telegramLinkedBody": "Vos notifications arrivent désormais sur Telegram.",
  "ProfileView.switched": "Connecté à votre compte",
  "ProfileView.switchedMoved": {
    "one": "{count} groupe déplacé depuis votre compte invité.",
    "many": "{count} groupes déplacés depuis votre compte invité.",
    "other": "{count} groupes déplacés depuis votre compte invité.",
  },
  "ProfileView.switchedDeleted": "Votre compte invité a été supprimé.",
  "ProfileView.methodLinked": "Méthode de connexion associée",
  "ProfileView.methodAlreadyLinked": "Méthode de connexion déjà associée",
  "ProfileView.methodNotLinked": "Méthode de connexion non associée",
  "ProfileView.unlinked": "{method} dissocié",
  "ProfileView.methodUnlinked": "Méthode de connexion dissociée",
  "ProfileView.unlinkedBody":
    "Les appareils qui l’utilisaient pour se connecter ont été déconnectés.",
  "ProfileView.signedOut": "Déconnecté",
  "ProfileView.deviceSignedOut": "Cet appareil a été déconnecté.",
  "ProfileView.othersSignedOut": "Tous les autres appareils ont été déconnectés.",
  "ProfileView.profileSaved": "Profil enregistré",
  "ProfileView.profileSavedBody": "Votre profil a été mis à jour.",
  "ProfileView.passwordChanged": "Mot de passe modifié",
  "ProfileView.tokensRevoked": {
    "one": "Votre jeton d’API a été révoqué.",
    "many": "Vos {count} jetons d’API ont été révoqués.",
    "other": "Vos {count} jetons d’API ont été révoqués.",
  },
  "ProfileView.usePassword": "Utilisez le nouveau mot de passe lors de votre prochaine connexion.",
  "ProfileView.passwordSet": "Mot de passe défini",
  "ProfileView.passwordSetBody":
    "Vous pouvez désormais aussi vous connecter avec votre adresse e-mail et ce mot de passe.",
  "ProfileView.accountDeleted": "Compte supprimé",
  "ProfileView.accountDeletedBody":
    "Il sera supprimé définitivement le {day}. Connectez-vous avant cette date pour le conserver.",
  "ProfileView.guestDeleted": "Compte invité supprimé",
  "ProfileView.guestDeletedBody": "Tout son contenu a disparu.",
  "ProfileView.emailVerified": "Adresse e-mail vérifiée",
  "ProfileView.emailVerifiedBody": "Votre adresse e-mail est vérifiée.",
  "ProfileView.tokenRevoked": "Jeton révoqué",
  "ProfileView.tokenRevokedBody": "Ce jeton ne fonctionne plus.",
  "ProviderProof.passkey": "une clé d’accès",
  "ProviderProof.link": "un lien de connexion",
  "ProviderProof.fresh":
    "Vous vous êtes connecté avec {methods} il y a un instant : vous n’avez donc pas besoin de mot de passe.",
  "ProviderProof.needed": {
    "one":
      "Ce compte n’a pas de mot de passe pour confirmer cette action. Reconnectez-vous avec {methods}, puis revenez ici dans un délai de {count} minute.",
    "many":
      "Ce compte n’a pas de mot de passe pour confirmer cette action. Reconnectez-vous avec {methods}, puis revenez ici dans un délai de {count} minutes.",
    "other":
      "Ce compte n’a pas de mot de passe pour confirmer cette action. Reconnectez-vous avec {methods}, puis revenez ici dans un délai de {count} minutes.",
  },
  "ProviderProof.passkeyAgain": "Se reconnecter avec une clé d’accès",
  "ProviderProof.providerAgain": "Se reconnecter avec {provider}",
  "SignInLinkScreen.sendFailed": "Impossible d’envoyer le lien. Réessayez dans un instant.",
  "SignInLinkScreen.unreachable":
    "Impossible de joindre le serveur. Vérifiez votre connexion et appuyez de nouveau sur Continuer.",
  "SignInLinkScreen.openFailed":
    "Impossible de vous connecter. Appuyez sur Continuer pour réessayer, ou demandez un nouveau lien.",
  "SignInLinkScreen.title": "Se connecter avec un lien",
  "SignInLinkScreen.description":
    "Nous vous enverrons par e-mail un lien qui vous connecte. Pas encore de compte avec cette adresse ? Le lien en crée un.",
  "SignInLinkScreen.ratherPassword":
    "Vous préférez un mot de passe ? <link>Retour à la connexion</link>",
  "SignInLinkScreen.submit": "Recevoir un lien par e-mail",
  "SignInLinkScreen.sent": {
    "one":
      "Nous avons envoyé un lien de connexion à <email>{email}</email>. Il fonctionne une seule fois, pendant {count} minute.",
    "many":
      "Nous avons envoyé un lien de connexion à <email>{email}</email>. Il fonctionne une seule fois, pendant {count} minutes.",
    "other":
      "Nous avons envoyé un lien de connexion à <email>{email}</email>. Il fonctionne une seule fois, pendant {count} minutes.",
  },
  "SignInLinkScreen.openHere": "Ouvrez-le sur cet appareil pour vous connecter ici.",
  "SignInLinkScreen.newLink": "Envoyer un nouveau lien",
  "SignInLinkScreen.waiting": {
    "one":
      "Rien reçu ? Vérifiez vos courriers indésirables. Vous pourrez envoyer un nouveau lien dans {count} seconde.",
    "many":
      "Rien reçu ? Vérifiez vos courriers indésirables. Vous pourrez envoyer un nouveau lien dans {count} secondes.",
    "other":
      "Rien reçu ? Vérifiez vos courriers indésirables. Vous pourrez envoyer un nouveau lien dans {count} secondes.",
  },
  "SignInLinkScreen.resent":
    "Un nouveau lien est en route. Les liens précédents fonctionnent toujours tant qu’aucun n’a été utilisé.",
  "SignInLinkScreen.refusedTitle": "Ce lien ne fonctionne plus",
  "SignInLinkScreen.refused": {
    "one":
      "Les liens de connexion fonctionnent une seule fois, pendant {count} minute. Demandez-en un nouveau et utilisez l’e-mail le plus récent.",
    "many":
      "Les liens de connexion fonctionnent une seule fois, pendant {count} minutes. Demandez-en un nouveau et utilisez l’e-mail le plus récent.",
    "other":
      "Les liens de connexion fonctionnent une seule fois, pendant {count} minutes. Demandez-en un nouveau et utilisez l’e-mail le plus récent.",
  },
  "SignInLinkScreen.elsewhereTitle": "Ce lien a été demandé dans un autre navigateur",
  "SignInLinkScreen.elsewhere":
    "Il ne vous a pas connecté, et votre compte invité n’a pas changé. Demandez un nouveau lien dans ce navigateur pour vous connecter ici.",
  "SignInLinkScreen.incompleteTitle": "Ce lien est incomplet",
  "SignInLinkScreen.incomplete":
    "Ouvrez à nouveau le lien depuis l’e-mail, ou demandez-en un nouveau.",
  "SignInLinkScreen.backToApp": "Retour à l’application",
  "SignInLinkScreen.finishTitle": "Terminer la connexion",
  "SignInLinkScreen.finish":
    "Continuez pour vous connecter sur cet appareil. Si l’adresse e-mail est nouvelle, votre compte sera créé.",
  "SignInLinkScreen.signedInAs":
    "Vous êtes connecté en tant que <email>{email}</email>. En continuant, vous serez connecté au compte du lien à la place.",
  "SignInLinkScreen.guest":
    "Vous utilisez l’application en tant qu’invité. Si vous avez demandé ce lien dans ce navigateur, en continuant, vous enregistrez ce compte invité sous l’adresse e-mail du lien. Si un compte existe déjà avec cette adresse, nous vous demanderons d’abord votre avis.",
  "SignInLinkScreen.signingIn": "Connexion…",
  "SignInLinkScreen.stay": "Rester connecté",
  "SignInMethods.failed": "Impossible de modifier vos méthodes de connexion",
  "SignInMethods.loadFailed":
    "Impossible de charger vos méthodes de connexion. Vérifiez votre connexion et réessayez.",
  "SignInMethods.renameFailed": "Impossible d’enregistrer le nom. Réessayez.",
  "SignInMethods.password": "Mot de passe",
  "SignInMethods.passkey": "Clé d’accès",
  "SignInMethods.title": "Méthodes de connexion",
  "SignInMethods.reloading": "Chargement des méthodes de connexion…",
  "SignInMethods.loading": "Chargement de vos méthodes de connexion…",
  "SignInMethods.removeNamed": "Retirer<name> {name}</name>",
  "SignInMethods.unlinkNamed": "Dissocier<name> {name}</name>",
  "SignInMethods.addPasskey": "Ajouter une clé d’accès",
  "SignInMethods.link": "Associer {provider}",
  "SignInMethods.linkTitle": "Associer",
  "SignInMethods.offline": "Il vous faut une connexion pour ajouter une clé d’accès.",
  "SignInMethods.cancelled": "Aucune clé d’accès n’a été ajoutée.",
  "SignInMethods.added":
    "Clé d’accès ajoutée sous le nom « <name>{name}</name> ». Renommez-la si vous le souhaitez.",
  "SignInMethods.passkeyAsks":
    "Une clé d’accès est une autre façon de vous connecter : nous vous demandons donc d’abord votre mot de passe.",
  "SignInMethods.linkAsks":
    "Un compte associé est une autre façon de vous connecter : nous vous demandons donc d’abord votre mot de passe.",
  "SignInMethods.opening": "Ouverture…",
  "SignInMethods.continueTo": "Continuer vers {provider}",
  "SignInMethods.removeTitle": "Retirer « {name} » ?",
  "SignInMethods.unlinkTitle": "Dissocier {name} ?",
  "SignInMethods.remove":
    "Vous ne pourrez plus vous connecter avec cette clé d’accès, et tous les appareils qui l’ont utilisée pour se connecter seront déconnectés. Supprimez-la aussi de votre gestionnaire de mots de passe.",
  "SignInMethods.removeCurrent":
    "Vous ne pourrez plus vous connecter avec cette clé d’accès, et tous les appareils qui l’ont utilisée pour se connecter seront déconnectés, y compris celui-ci. Supprimez-la aussi de votre gestionnaire de mots de passe.",
  "SignInMethods.unlinkCurrent":
    "Vous vous êtes connecté sur cet appareil avec {name} : cet appareil sera donc déconnecté lui aussi, comme tous les autres appareils qui l’ont utilisé.",
  "SignInMethods.unlink":
    "Tous les appareils qui se sont connectés avec {name} seront déconnectés. Cet appareil reste connecté.",
  "SignInMethods.removing": "Retrait…",
  "SignInMethods.unlinking": "Dissociation…",
  "SignInMethods.removePasskey": "Retirer la clé d’accès",
  "SignInMethods.unlinkButton": "Dissocier",
  "SignInMethods.rename": "Renommer {name}",
  "SignInMethods.passkeyName": "Nom de la clé d’accès",
  "SignInMethods.addedUsed": "Ajoutée <added></added> · Dernière utilisation <used></used>",
  "SignInMethods.addedUnused": "Ajoutée <added></added> · Pas encore utilisée",
  "SignInMethods.usedHere": "Utilisée sur cet appareil",
  "SignInMethods.onlyPasskey":
    "C’est votre seule méthode de connexion : vous ne pouvez donc pas la retirer.",
  "SignInMethods.onlyLinked":
    "C’est votre seule méthode de connexion : vous ne pouvez donc pas la dissocier.",
  "SignInMethods.passkeyNotSaved": "Impossible d’enregistrer la clé d’accès. Réessayez.",
  "SignInMethods.passkeyOnDevice": "Cet appareil possède déjà une clé d’accès pour votre compte.",
  "SignUpCodeScreen.checkFailed": "Impossible de vérifier le code",
  "SignUpCodeScreen.offline": "Vous êtes hors ligne. Connectez-vous à Internet et réessayez.",
  "SignUpCodeScreen.title": "Consultez votre boîte de réception",
  "SignUpCodeScreen.loading": "Chargement…",
  "SignUpCodeScreen.sent": {
    "one": "Nous avons envoyé un code à <email>{email}</email>. Il est valable {count} minute.",
    "many": "Nous avons envoyé un code à <email>{email}</email>. Il est valable {count} minutes.",
    "other": "Nous avons envoyé un code à <email>{email}</email>. Il est valable {count} minutes.",
  },
  "SignUpCodeScreen.wrongAddress": "Mauvaise adresse ? <button>En utiliser une autre</button>",
  "SignUpCodeScreen.code": "Code",
  "SignUpCodeScreen.checking": "Vérification…",
  "SignUpCodeScreen.resend": "Envoyer un nouveau code",
  "SignUpCodeScreen.resent": "Un nouveau code est en route.",
  "SignUpCodeScreen.resendFailed": "Impossible d’envoyer un nouveau code",
  "SignUpCodeScreen.existsTitle": "Vous avez déjà un compte",
  "SignUpCodeScreen.exists":
    "Un compte existe déjà ici avec <email>{email}</email>. Aucun nouveau compte n’a été créé.",
  "SignUpCodeScreen.existsWith":
    "Un compte existe déjà ici avec <email>{email}</email>, et il se connecte avec {providers}. Aucun nouveau compte n’a été créé.",
  "SignUpCodeScreen.signInInstead": "Se connecter plutôt",
  "SignUpCodeScreen.expiredTitle": "Cette inscription a expiré",
  "SignUpCodeScreen.expired": {
    "one":
      "Elle a pris plus de {count} minute, ou le code a été mal saisi trop de fois. Rien n’a été créé.",
    "many":
      "Elle a pris plus de {count} minutes, ou le code a été mal saisi trop de fois. Rien n’a été créé.",
    "other":
      "Elle a pris plus de {count} minutes, ou le code a été mal saisi trop de fois. Rien n’a été créé.",
  },
  "SignUpCodeScreen.startAgain": "Recommencer",
  "SignedInDevices.failed": "Impossible de déconnecter cet appareil",
  "SignedInDevices.savedTitle": "Copie enregistrée de vos appareils",
  "SignedInDevices.savedBody":
    "Impossible de joindre le serveur. Voici la liste enregistrée sur cet appareil : {time}. Les appareils connectés ou déconnectés depuis n’y figurent pas.",
  "SignedInDevices.title": "Appareils connectés",
  "SignedInDevices.description":
    "Les appareils où votre compte est connecté. Déconnectez ceux que vous ne reconnaissez pas.",
  "SignedInDevices.loading": "Chargement de vos appareils…",
  "SignedInDevices.signOutDevice": "Déconnecter<device> {device}</device>",
  "SignedInDevices.signingOut": "Déconnexion…",
  "SignedInDevices.signOutOthers": "Déconnecter tous les autres appareils",
  "SignedInDevices.othersTitle": "Déconnecter tous les autres appareils ?",
  "SignedInDevices.othersMessage": {
    "one":
      "{count} autre appareil devra saisir votre mot de passe pour se reconnecter. Cet appareil reste connecté.",
    "many":
      "{count} autres appareils devront saisir votre mot de passe pour se reconnecter. Cet appareil reste connecté.",
    "other":
      "{count} autres appareils devront saisir votre mot de passe pour se reconnecter. Cet appareil reste connecté.",
  },
  "SignedInDevices.signOut": "Déconnecter",
  "SignedInDevices.oneTitle": "Déconnecter {device} ?",
  "SignedInDevices.oneMessage": "Cet appareil devra saisir votre mot de passe pour se reconnecter.",
  "SignedInDevices.thisDevice": "Cet appareil",
  "SignedInDevices.lastActive": "Dernière activité <when></when>",
  "SignedInDevices.ip": "<label>Adresse IP</label> <ip>{ip}</ip>",
  "Search.search": "Rechercher",
  "Search.placeholder": "Rechercher des notes et des groupes",
  "Search.close": "Fermer la recherche",
  "Search.loading": "Recherche…",
  "Search.error": "La recherche a échoué. Modifiez votre recherche pour réessayer.",
  "Search.tooShort": {
    "one": "Saisissez au moins {count} caractère pour rechercher des notes.",
    "many": "Saisissez au moins {count} caractères pour rechercher des notes.",
    "other": "Saisissez au moins {count} caractères pour rechercher des notes.",
  },
  "Search.empty": "Aucune note ni aucun groupe ne correspond à « {query} ».",
  "Search.emptyOnDevice":
    "Rien sur cet appareil ne correspond à « {query} ». Relancez la recherche une fois de retour en ligne.",
  "Search.notes": "Notes",
  "Search.notesOnDevice": "Notes sur cet appareil",
  "Search.groups": "Groupes",
  "Search.actions": "Actions",
  "Search.untitled": "Note sans titre",
  "Search.current": "Actuel",
  "Search.inGroup": "Dans {group}",
  "Search.keep": "Gardez votre compte",
  "Search.keepDetail":
    "Créer un compte, s’inscrire ou enregistrer ce compte invité avec une méthode de connexion",
  "Search.newNote": "Nouvelle note",
  "Search.newTag": "Nouvelle étiquette",
  "Search.newGroup": "Nouveau groupe",
  "Search.openOverview": "Ouvrir la vue d’ensemble",
  "Search.openNotifications": "Ouvrir les notifications",
  "Search.openProfile": "Ouvrir le profil",
  "Search.profileDetail": "Nom, adresse e-mail, mot de passe, double authentification",
  "Search.downloadData": "Télécharger mes données",
  "Search.downloadDetail": "Un fichier ZIP de votre profil, de vos groupes et de vos notes",
  "Search.changePicture": "Changer de photo de profil",
  "Shortcuts.general": "Général",
  "Shortcuts.goTo": "Aller à",
  "Shortcuts.newNote": "Dans Nouvelle note",
  "Shortcuts.page": "Cette page",
  "Shortcuts.show": "Afficher les raccourcis clavier",
  "Shortcuts.close": "Fermer une boîte de dialogue ou un menu",
  "Shortcuts.switchLabel": "Raccourcis à une touche",
  "Shortcuts.inFields": "Les raccourcis ne fonctionnent pas pendant la saisie dans un champ.",
  "Shortcuts.off": "Les raccourcis à une touche sont désactivés sur cet appareil.",
  "Shortcuts.search": "Rechercher des notes et des groupes",
  "Shortcuts.newNoteRow": "Nouvelle note",
  "Shortcuts.undo": "Annuler la suppression d’une note, tant que son message est affiché",
  "Shortcuts.notifications": "Notifications",
  "Shortcuts.profile": "Profil",
  "Shortcuts.dateRange": "Changer de période",
  "Shortcuts.customise": "Personnaliser la vue d’ensemble",
  "Shortcuts.addNote": "Ajouter la note",
  "Shortcuts.addAndOpen": "Ajouter et ouvrir",
  "TagEditor.title": "Étiquette",
  "TagEditor.back": "Retour aux étiquettes",
  "TagEditor.notFound": "Cette étiquette n’existe pas.",
  "TagEditor.notFoundHint": "Elle a peut-être été supprimée.",
  "TagEditor.loading": "Chargement de l’étiquette…",
  "TagEditor.new": "Nouvelle étiquette",
  "TagEditor.offlineTitle": "Vous êtes hors ligne",
  "TagEditor.offline":
    "Vos modifications sont enregistrées sur cet appareil et seront synchronisées dès votre retour en ligne.",
  "TagEditor.readOnly": "Seuls les éditeurs peuvent modifier les étiquettes de ce groupe.",
  "TagEditor.name": "Nom",
  "TagEditor.nameHint": "Tous les membres de <group>{group}</group> voient cette étiquette.",
  "TagEditor.namePlaceholder": "Nom de l’étiquette",
  "TagEditor.saving": "Enregistrement…",
  "TagEditor.creating": "Création…",
  "TagEditor.save": "Enregistrer l’étiquette",
  "TagEditor.create": "Créer l’étiquette",
  "TagEditorView.createdTitle": "Étiquette créée",
  "TagEditorView.created": "« {name} » créée.",
  "TagEditorView.savedTitle": "Étiquette enregistrée",
  "TagEditorView.saved": "« {name} » enregistrée.",
  "TagEditorView.discardTitle": "Abandonner vos modifications ?",
  "TagEditorView.discard": "Vous n’avez pas enregistré vos modifications de « {name} ».",
  "TagEditorView.discardNew": "Vous n’avez pas encore créé cette étiquette.",
  "TagEditorView.discardLeave": "Abandonner les modifications",
  "TagEditorView.discardStay": "Continuer à modifier",
  "TagMessages.nameRequired": "Saisissez un nom.",
  "TagMessages.nameTaken": "Ce groupe a déjà une étiquette portant ce nom.",
  "TagMessages.conflict":
    "Quelqu’un a modifié cette étiquette depuis que vous l’avez ouverte. Vous voyez maintenant la dernière version.",
  "TagMessages.gone": "Cette étiquette a été supprimée.",
  "TagMessages.load": "Impossible de charger les étiquettes",
  "TagMessages.create": "Impossible de créer l’étiquette. Réessayez.",
  "TagMessages.save": "Impossible d’enregistrer l’étiquette. Réessayez.",
  "TagMessages.delete": "Impossible de supprimer l’étiquette",
  "TagParts.list": "Étiquettes",
  "TagParts.more": "et {names}",
  "TagParts.noNotes": "Aucune note",
  "TagParts.noteCount": {
    "one": "{count} note",
    "many": "{count} notes",
    "other": "{count} notes",
  },
  "TagParts.deleteNone": "Aucune note ne porte cette étiquette.",
  "TagParts.deleteUnknown":
    "Elle est retirée de toutes les notes qui la portent. Les notes sont conservées.",
  "TagParts.deleteCount": {
    "one": "Elle est retirée de {count} note. La note est conservée.",
    "many": "Elle est retirée de {count} notes. Les notes sont conservées.",
    "other": "Elle est retirée de {count} notes. Les notes sont conservées.",
  },
  "TagSync.gone": "Cette étiquette a été supprimée pendant que vous étiez hors ligne.",
  "TagSync.rejected": "Le serveur n’a pas accepté cette étiquette.",
  "TagSync.version": "Quelqu’un a modifié cette étiquette pendant que vous étiez hors ligne.",
  "Tags.title": "Étiquettes",
  "Tags.new": "Nouvelle étiquette",
  "Tags.readOnly":
    "Vous pouvez consulter ces étiquettes, mais seuls les éditeurs peuvent les modifier.",
  "Tags.loading": "Chargement des étiquettes…",
  "Tags.empty": "Aucune étiquette pour l’instant",
  "Tags.emptyHint": "Étiquetez vos notes pour les retrouver facilement plus tard.",
  "Tags.edit": "Modifier {name}",
  "Tags.showNotes": {
    "one": "Afficher la note étiquetée {name}",
    "many": "Afficher les {count} notes étiquetées {name}",
    "other": "Afficher les {count} notes étiquetées {name}",
  },
  "Tags.actions": "Actions pour {name}",
  "Tags.editTag": "Modifier l’étiquette",
  "Tags.deleteTag": "Supprimer l’étiquette",
  "Tags.deleteTitle": "Supprimer l’étiquette « {name} » ?",
  "Tags.cancel": "Annuler",
  "TagToasts.deletedTitle": "Étiquette supprimée",
  "TagToasts.deleted": "« {name} » a été supprimée.",
  "TagToasts.deletedFromNotes": {
    "one": "« {name} » a été supprimée et retirée de {count} note.",
    "many": "« {name} » a été supprimée et retirée de {count} notes.",
    "other": "« {name} » a été supprimée et retirée de {count} notes.",
  },
  "TelegramNotification.open": "Ouvrir",
  "TelegramBot.linkButton": "Associer",
  "TelegramBot.confirmNameAddress":
    "Associer ce compte Telegram au compte de {name} sur {app} ({address}) ? Appuyez sur « {button} » uniquement s’il s’agit de votre propre compte. Si vous n’avez rien demandé, ignorez ce message.",
  "TelegramBot.confirmName":
    "Associer ce compte Telegram au compte de {name} sur {app} ? Appuyez sur « {button} » uniquement s’il s’agit de votre propre compte. Si vous n’avez rien demandé, ignorez ce message.",
  "TelegramBot.confirmAddress":
    "Associer ce compte Telegram à un compte sur {app} ({address}) ? Appuyez sur « {button} » uniquement s’il s’agit de votre propre compte. Si vous n’avez rien demandé, ignorez ce message.",
  "TelegramBot.confirmAnonymous":
    "Associer ce compte Telegram à un compte sur {app} sans nom ni adresse e-mail ? Appuyez sur « {button} » uniquement s’il s’agit de votre propre compte. Si vous n’avez rien demandé, ignorez ce message.",
  "TelegramBot.linked":
    "C’est fait : cette conversation est associée à votre compte. Vos notifications arrivent désormais ici. Envoyez /help pour voir ce que je sais faire.",
  "TelegramBot.already": "Ce compte Telegram est déjà associé à votre compte.",
  "TelegramBot.taken":
    "Ce compte Telegram est associé à un autre compte. Envoyez d’abord /unlink, puis renvoyez le code.",
  "TelegramBot.invalid": {
    "one":
      "Ce code ne fonctionne pas. Il contient peut-être une faute de frappe, a déjà été utilisé ou date de plus de {count} minute. Créez-en un nouveau dans l’application.",
    "many":
      "Ce code ne fonctionne pas. Il contient peut-être une faute de frappe, a déjà été utilisé ou date de plus de {count} minutes. Créez-en un nouveau dans l’application.",
    "other":
      "Ce code ne fonctionne pas. Il contient peut-être une faute de frappe, a déjà été utilisé ou date de plus de {count} minutes. Créez-en un nouveau dans l’application.",
  },
  "TelegramBot.stale": {
    "one":
      "Ce bouton ne fonctionne plus. Il a déjà été utilisé, un plus récent l’a remplacé, ou il date de plus de {count} minute. Pour associer cette conversation, créez un nouveau code dans l’application.",
    "many":
      "Ce bouton ne fonctionne plus. Il a déjà été utilisé, un plus récent l’a remplacé, ou il date de plus de {count} minutes. Pour associer cette conversation, créez un nouveau code dans l’application.",
    "other":
      "Ce bouton ne fonctionne plus. Il a déjà été utilisé, un plus récent l’a remplacé, ou il date de plus de {count} minutes. Pour associer cette conversation, créez un nouveau code dans l’application.",
  },
  "TelegramBot.privateOnly": "Envoyez-moi cela dans une conversation privée.",
  "TelegramBot.codeSpent":
    "Ce code a été envoyé là où d’autres peuvent le lire : il ne fonctionne donc plus. Créez-en un nouveau dans l’application et envoyez-le-moi dans une conversation privée.",
  "TelegramBot.unlinked":
    "Dissocié. Cette conversation ne recevra plus de notifications de votre compte.",
  "TelegramBot.notLinked": "Ce compte Telegram n’est associé à aucun compte.",
  "TelegramBot.howToLink":
    "Pour associer votre compte, ouvrez {url}, choisissez « {action} » et envoyez-moi le code affiché.",
  "TelegramBot.hello":
    "Bonjour ! Votre compte est associé. Envoyez /help pour voir ce que je sais faire.",
  "TelegramBot.helloName":
    "Bonjour {name} ! Votre compte est associé. Envoyez /help pour voir ce que je sais faire.",
  "UndoToast.title": "Note supprimée",
  "UndoToast.deleted": "« {title} » a été supprimée.",
  "UndoToast.deletedUntitled": "La note a été supprimée.",
  "UndoToast.keyHint": "Appuyez sur {key} pour annuler.",
  "UndoToast.undo": "Annuler",
  "ApiDocsLink.newTab": ", s’ouvre dans un nouvel onglet",
  "ApiTokenNewScreen.title": "Nouveau jeton d’API",
  "ApiTokenNewScreen.copyTitle": "Copiez votre jeton",
  "ApiTokenNewScreen.back": "Retour aux jetons d’API",
  "ApiTokenNewScreen.intro": "Un jeton permet à un script d’utiliser un groupe via l’API.",
  "ApiTokenNewScreen.docs": "Lire la documentation de l’API",
  "ApiTokenNewScreen.loadingGroups": "Chargement de vos groupes…",
  "ApiTokenNewScreen.noGroup":
    "Vous ne faites partie d’aucun groupe pour lequel vous pouvez créer un jeton.",
  "ApiTokenNewScreen.backToProfile": "Retour au profil",
  "ApiTokenNewScreen.offlineTitle": "Vous êtes hors ligne",
  "ApiTokenNewScreen.offline":
    "Il vous faut une connexion pour créer un jeton. Réessayez une fois de retour en ligne.",
  "ApiTokenNewScreen.name": "Nom",
  "ApiTokenNewScreen.nameHint": "Pour distinguer vos jetons, par exemple « Script de sauvegarde ».",
  "ApiTokenNewScreen.nameMissing": "Saisissez un nom.",
  "ApiTokenNewScreen.group": "Groupe",
  "ApiTokenNewScreen.access": "Accès",
  "ApiTokenNewScreen.expiresAfter": "Expire après",
  "ApiTokenNewScreen.days": {
    "one": "{count} jour",
    "many": "{count} jours",
    "other": "{count} jours",
  },
  "ApiTokenNewScreen.never": "Jamais",
  "ApiTokenNewScreen.password": "Votre mot de passe",
  "ApiTokenNewScreen.passwordHint":
    "Un jeton fonctionne sans votre mot de passe : nous vous le demandons donc avant d’en créer un.",
  "ApiTokenNewScreen.passwordMissing": "Saisissez votre mot de passe pour créer un jeton.",
  "ApiTokenNewScreen.createFailed": "Impossible de créer le jeton. Réessayez.",
  "ApiTokenNewScreen.cancel": "Annuler",
  "ApiTokenNewScreen.creating": "Création…",
  "ApiTokenNewScreen.create": "Créer le jeton",
  "ApiTokenNewScreen.copyNow":
    "Copiez ce jeton maintenant et conservez-le en lieu sûr. Vous ne pourrez plus le revoir.",
  "ApiTokenNewScreen.copy": "Copier le jeton",
  "ApiTokenNewScreen.copied": "Jeton copié",
  "ApiTokenNewScreen.sendAs": "Envoyez-le sous la forme <code>{header}</code>.",
  "ApiTokenNewScreen.yourToken": "votre jeton",
  "ApiTokenNewScreen.quickStart": "Voir le guide de démarrage",
  "ApiTokenNewScreen.done": "Terminé",
  "ApiTokenNewView.leaveTitle": "Partir sans copier ?",
  "ApiTokenNewView.leaveMessage": "Vous ne pourrez plus revoir ce jeton.",
  "ApiTokenNewView.leave": "Partir",
  "ApiTokenNewView.stay": "Rester",
  "ApiTokenNewView.discardTitle": "Abandonner vos modifications ?",
  "ApiTokenNewView.discardMessage": "Vous n’avez pas encore créé ce jeton.",
  "ApiTokenNewView.discard": "Abandonner les modifications",
  "ApiTokenNewView.keepEditing": "Continuer à modifier",
  "ApiTokens.failed": "Un problème est survenu avec vos jetons d’API.",
  "ApiTokens.savedCopyTitle": "Copie enregistrée de vos jetons d’API",
  "ApiTokens.savedCopyBody":
    "Impossible de joindre le serveur. Voici la liste enregistrée sur cet appareil : {time}. Les jetons créés ou révoqués depuis n’y figurent pas.",
  "ApiTokens.new": "Nouveau jeton",
  "ApiTokens.howToUse": "Comment utiliser un jeton",
  "ApiTokens.loading": "Chargement de vos jetons…",
  "ApiTokens.emptyTitle": "Aucun jeton d’API",
  "ApiTokens.emptyText":
    "Un jeton agit en votre nom dans un groupe, en lecture seule ou en lecture et écriture.",
  "ApiTokens.revokeNamed": "Révoquer <name>{name}</name>",
  "ApiTokens.passwordRevokes":
    "Modifier ou réinitialiser votre mot de passe révoque tous les jetons.",
  "ApiTokens.revokeTitle": "Révoquer « <name>{name}</name> » ?",
  "ApiTokens.revokeMessage":
    "Tout ce qui utilise ce jeton cesse de fonctionner immédiatement. Cette action est irréversible.",
  "ApiTokens.revoke": "Révoquer",
  "ApiTokens.cancel": "Annuler",
  "ApiTokens.readWrite": "Lecture et écriture",
  "ApiTokens.readOnly": "Lecture seule",
  "ApiTokens.expires": "Expire <date>{date}</date>",
  "ApiTokens.neverExpires": "N’expire jamais",
  "ApiTokens.lastUsed": "Dernière utilisation <when>{when}</when>",
  "ApiTokens.neverUsed": "Jamais utilisé",
  "AccountDelete.members": "D’autres personnes l’utilisent encore. Transférez-le ou retirez-les.",
  "AccountDelete.subscription": "Il a encore un forfait payant. Résiliez d’abord le forfait.",
  "AccountDelete.planEnding":
    "Son forfait est résilié mais reste actif jusqu’au {day}. Attendez qu’il prenne fin.",
  "AccountDelete.planEndingPeriod":
    "Son forfait est résilié mais reste actif jusqu’à la fin de la période. Attendez qu’il prenne fin.",
  "AccountDelete.title": "Supprimer mon compte",
  "AccountDelete.summary": {
    "one":
      "Votre compte et les groupes que vous êtes seul à utiliser sont supprimés définitivement {count} jour après votre demande. Connectez-vous avant pour les conserver.",
    "many":
      "Votre compte et les groupes que vous êtes seul à utiliser sont supprimés définitivement {count} jours après votre demande. Connectez-vous avant pour les conserver.",
    "other":
      "Votre compte et les groupes que vous êtes seul à utiliser sont supprimés définitivement {count} jours après votre demande. Connectez-vous avant pour les conserver.",
  },
  "AccountDelete.copyFirst":
    "Vous voulez d’abord une copie ? <link>Téléchargez vos données</link>.",
  "AccountDelete.deleteHidden": "Supprimer<hidden> mon compte</hidden>",
  "AccountDelete.checking": "Vérification de vos groupes…",
  "AccountDelete.explain": {
    "one":
      "Vous serez déconnecté immédiatement sur tous vos appareils. Votre compte et les groupes que vous êtes seul à utiliser seront supprimés définitivement dans {count} jour. Connectez-vous avant pour restaurer votre compte. Les notes que vous avez écrites dans les groupes d’autres personnes y restent, attribuées à « Utilisateur supprimé ».",
    "many":
      "Vous serez déconnecté immédiatement sur tous vos appareils. Votre compte et les groupes que vous êtes seul à utiliser seront supprimés définitivement dans {count} jours. Connectez-vous avant pour restaurer votre compte. Les notes que vous avez écrites dans les groupes d’autres personnes y restent, attribuées à « Utilisateur supprimé ».",
    "other":
      "Vous serez déconnecté immédiatement sur tous vos appareils. Votre compte et les groupes que vous êtes seul à utiliser seront supprimés définitivement dans {count} jours. Connectez-vous avant pour restaurer votre compte. Les notes que vous avez écrites dans les groupes d’autres personnes y restent, attribuées à « Utilisateur supprimé ».",
  },
  "AccountDelete.deleting": "Suppression…",
  "AccountDelete.blocked":
    "Vous êtes propriétaire de groupes que d’autres personnes utilisent ou paient encore. Réglez d’abord la situation de chacun, puis revenez.",
  "AuthScreen.demoNote":
    "Ceci est une démo publique réinitialisée chaque nuit. Les nouveaux comptes contiennent des données d’exemple à explorer.",
  "AuthScreen.demoGuestNote":
    "Ceci est une démo publique réinitialisée chaque nuit. Chaque nouveau compte, invité ou non, contient des données d’exemple à explorer.",
  "AuthScreen.tryFirst":
    "Essayez d’abord l’application, ou créez un compte avec votre adresse e-mail.",
  "AuthScreen.invitedTitle": "Vous êtes invité dans un groupe",
  "AuthScreen.invitedSignIn": "Connectez-vous pour voir l’invitation et rejoindre le groupe.",
  "AuthScreen.invitedSignUp":
    "Créez un compte pour voir l’invitation et rejoindre le groupe. Vous en avez déjà un ? Connectez-vous plutôt.",
  "AuthScreen.loginOrUsername": "Adresse e-mail ou nom d’utilisateur",
  "AuthScreen.email": "Adresse e-mail",
  "AuthScreen.signInTitle": "Bon retour parmi nous",
  "AuthScreen.signInDescription":
    "Connectez-vous avec votre adresse e-mail ou votre nom d’utilisateur.",
  "AuthScreen.signInFailed": "Impossible de vous connecter. Réessayez.",
  "AuthScreen.signUpTitle": "Créez votre compte",
  "AuthScreen.signUpDescription":
    "Juste une adresse e-mail et un mot de passe. Nous vous enverrons un code pour confirmer votre adresse.",
  "AuthScreen.signUpFailed": "Impossible de créer votre compte. Réessayez.",
  "AuthScreen.codeTitle": "Saisissez votre code",
  "AuthScreen.codeDescription":
    "Ouvrez votre application d’authentification et saisissez le code à six chiffres qu’elle affiche.",
  "AuthScreen.codeFailed": "Ce code n’a pas fonctionné. Réessayez.",
  "AuthScreen.forgotten": "C’est fait. Ce navigateur ne retiendra plus votre méthode de connexion.",
  "AuthScreen.lastPassword":
    "La dernière fois, vous vous êtes connecté avec votre mot de passe<email> ({email})</email>.",
  "AuthScreen.lastPasskey":
    "La dernière fois, vous vous êtes connecté avec une clé d’accès<email> ({email})</email>.",
  "AuthScreen.lastLink":
    "La dernière fois, vous vous êtes connecté avec un lien par e-mail<email> ({email})</email>.",
  "AuthScreen.lastProvider":
    "La dernière fois, vous vous êtes connecté avec {provider}<email> ({email})</email>.",
  "AuthScreen.forget": "Ce n’est pas vous ? Utilisez un autre compte",
  "AuthScreen.openProfile": "Ouvrir votre profil",
  "AuthScreen.noCodeTitle": "Aucun code nécessaire",
  "AuthScreen.noCodeText": "Cette connexion ne nécessite pas de code.",
  "AuthScreen.signedInTitle": "Vous êtes connecté",
  "AuthScreen.signedInText": "Rien à faire ici.",
  "AuthScreen.newHere": "Nouveau ici ? <link>Créer un compte</link>",
  "AuthScreen.haveAccount": "Vous avez déjà un compte ? <link>Se connecter</link>",
  "AuthScreen.lostDevice": "Appareil perdu ? <link>Retour à la connexion</link>",
  "AuthScreen.sending": "Envoi…",
  "AuthScreen.emailSignInLink": "Recevoir un lien de connexion par e-mail",
  "AuthScreen.emailSignUpLink": "Recevoir un lien d’inscription par e-mail",
  "AuthScreen.orCreate": "ou créez un compte",
  "AuthScreen.createAccount": "Créer un compte",
  "AuthScreen.continue": "Continuer",
  "AuthScreen.codeHint": "Six chiffres de votre application d’authentification.",
  "AuthScreen.forgotPassword": "Mot de passe oublié ?",
  "AuthScreen.otherWays": "Autres méthodes de connexion",
  "AuthScreen.waitingDevice": "En attente de votre appareil…",
  "AuthScreen.passkey": "Se connecter avec une clé d’accès",
  "AuthScreen.continueWith": "Continuer avec {provider}",
  "ConfirmSignUpScreen.failed": "Impossible de créer votre compte",
  "ConfirmSignUpScreen.title": "Créer un nouveau compte ?",
  "ConfirmSignUpScreen.goneTitle": "Rien à confirmer",
  "ConfirmSignUpScreen.gone":
    "Cette demande a expiré au bout de dix minutes, ou vous y avez déjà répondu. Aucun compte n’a été créé.",
  "ConfirmSignUpScreen.backToSignIn": "Retour à la connexion",
  "ConfirmSignUpScreen.unknown": "Ce compte {provider} n’est associé à aucun compte ici.",
  "ConfirmSignUpScreen.unknownColon": "Ce compte {provider} n’est associé à aucun compte ici :",
  "ConfirmSignUpScreen.goBack":
    "Vous avez déjà un compte ? Revenez en arrière et connectez-vous comme d’habitude, puis associez {provider} dans votre profil. Rien n’a encore été créé.",
  "ConfirmSignUpScreen.unconfirmed":
    "<strong>Un compte ici utilise déjà cette adresse e-mail, mais ne l’a jamais confirmée.</strong> Créer un nouveau compte verrouille celui-ci : son mot de passe cesse de fonctionner et ses appareils sont déconnectés. Pour le garder, revenez en arrière, connectez-vous avec son mot de passe et confirmez l’adresse e-mail avec le code que nous vous enverrons.",
  "ConfirmSignUpScreen.back": "J’ai déjà un compte. Retour à la connexion",
  "ConfirmSignUpScreen.creating": "Création de votre compte…",
  "ConfirmSignUpScreen.create": "Créer un nouveau compte",
  "EmailScreen.verifyFailed": "Impossible de vérifier le code",
  "EmailScreen.sendFailed": "Impossible d’envoyer un nouveau code",
  "EmailScreen.changeFailed": "Impossible de modifier votre adresse e-mail",
  "EmailScreen.loadFailed": "Impossible de charger votre adresse e-mail.",
  "EmailScreen.enterCode": "Saisir le code",
  "EmailScreen.banner": "Confirmez <email>{email}</email> avec le code que nous y envoyons.",
  "EmailScreen.tryAgain": "Réessayer",
  "EmailScreen.changeTitle": "Modifier l’adresse e-mail",
  "EmailScreen.addTitle": "Ajouter une adresse e-mail",
  "EmailScreen.close": "Fermer",
  "EmailScreen.cancel": "Annuler",
  "EmailScreen.codeSent": {
    "one":
      "Saisissez le code de l’e-mail envoyé à <email>{email}</email>. Il fonctionne une seule fois, pendant {count} minute.",
    "many":
      "Saisissez le code de l’e-mail envoyé à <email>{email}</email>. Il fonctionne une seule fois, pendant {count} minutes.",
    "other":
      "Saisissez le code de l’e-mail envoyé à <email>{email}</email>. Il fonctionne une seule fois, pendant {count} minutes.",
  },
  "EmailScreen.codeResent": "Un nouveau code est en route vers <email>{email}</email>.",
  "EmailScreen.codeSentKeep": {
    "one":
      "Saisissez le code de l’e-mail envoyé à <email>{email}</email>. Il fonctionne une seule fois, pendant {count} minute. D’ici là, vous continuerez à vous connecter avec <current>{current}</current>.",
    "many":
      "Saisissez le code de l’e-mail envoyé à <email>{email}</email>. Il fonctionne une seule fois, pendant {count} minutes. D’ici là, vous continuerez à vous connecter avec <current>{current}</current>.",
    "other":
      "Saisissez le code de l’e-mail envoyé à <email>{email}</email>. Il fonctionne une seule fois, pendant {count} minutes. D’ici là, vous continuerez à vous connecter avec <current>{current}</current>.",
  },
  "EmailScreen.confirm": "Confirmer l’adresse e-mail",
  "EmailScreen.noMail": "Rien reçu ? <button>Envoyer un nouveau code</button>",
  "EmailScreen.changeProvider":
    "Nous enverrons un code à votre nouvelle adresse e-mail. Elle sera modifiée dès que vous l’aurez saisi. Vous continuerez à vous connecter avec {providers}.",
  "EmailScreen.changeKeep":
    "Nous enverrons un code à votre nouvelle adresse e-mail. Tant que vous ne l’aurez pas saisi, vous continuerez à vous connecter avec <current>{current}</current>.",
  "EmailScreen.changeNew":
    "Nous enverrons un code à votre nouvelle adresse e-mail. Une fois le code saisi, vous vous connecterez avec cette adresse.",
  "EmailScreen.newAddress": "Nouvelle adresse e-mail",
  "EmailScreen.currentPassword": "Mot de passe actuel",
  "EmailScreen.sendCode": "Envoyer le code",
  "EmailScreen.verified": "Vérifiée",
  "EmailScreen.notVerified": "Non vérifiée",
  "Benchmark.title": "Benchmark",
  "Benchmark.subtitle": "Les performances d’un grand groupe sur cet appareil.",
  "Benchmark.opening": "Ouverture du benchmark…",
  "Benchmark.groupLabel": "Groupe à mesurer",
  "Benchmark.groupPlaceholder": "Choisir un groupe",
  "Benchmark.groupHint": "Le test télécharge toutes les notes du groupe sur cet appareil.",
  "Benchmark.run": "Lancer le benchmark",
  "Benchmark.runAgain": "Relancer",
  "Benchmark.stop": "Arrêter",
  "Benchmark.copy": "Copier les résultats",
  "Benchmark.share": "Partager",
  "Benchmark.jsonLabel": "Résultats sur une ligne",
  "Benchmark.keepInFront": "Gardez cet onglet ouvert et au premier plan jusqu’à la fin du test.",
  "Benchmark.measurements": "Mesures",
  "Benchmark.stepDownload": "Télécharger le groupe",
  "Benchmark.stepSave": "Enregistrer sur cet appareil",
  "Benchmark.stepStartOffline": "Démarrer hors ligne depuis la copie enregistrée",
  "Benchmark.stepFirstNotes": "Afficher les premières notes",
  "Benchmark.stepScroll": "Faire défiler la liste",
  "Benchmark.stepSearch": "Rechercher sur cet appareil",
  "Benchmark.stepFilter": "Filtrer la liste",
  "Benchmark.stepMemory": "Mémoire utilisée par la page",
  "Benchmark.stepStorage": "Stockage utilisé sur cet appareil",
  "Benchmark.stepClear": "Effacer la copie de cet appareil",
  "Benchmark.budgetDownload": "Objectif : moins de 10 s en 4G",
  "Benchmark.budgetSecond": "Objectif : moins de 1 s",
  "Benchmark.budgetScroll": "Objectif : moins de 5 % d’images perdues",
  "Benchmark.budgetFast": "Objectif : moins de 100 ms",
  "Benchmark.noBudget": "Aucun objectif",
  "Benchmark.within": "Objectif atteint",
  "Benchmark.over": "Objectif dépassé",
  "Benchmark.notMeasured": "Non mesuré",
  "Benchmark.unavailableDetail": "Ce navigateur ne fournit pas cette donnée.",
  "Benchmark.seconds": "{value} s",
  "Benchmark.milliseconds": "{value} ms",
  "Benchmark.framesDropped": "{percent} % d’images perdues",
  "Benchmark.storageOf": "{size} sur {quota}",
  "Benchmark.cleared": "Effacée",
  "Benchmark.kept": "Conservée pour le groupe ouvert",
  "Benchmark.deviceHeading": "Cet appareil",
  "Benchmark.browser": "Navigateur",
  "Benchmark.cores": "Cœurs du processeur",
  "Benchmark.memory": "Mémoire",
  "Benchmark.connection": "Connexion",
  "Benchmark.notReported": "Non communiqué",
  "Benchmark.stepOf": "Étape {n} sur {total} : {measure}",
  "Benchmark.notesProgress": "{done} notes sur {total}",
  "Benchmark.stoppedAt":
    "Arrêté à l’étape « {measure} ». Les résultats obtenus jusque-là figurent ci-dessous.",
  "Benchmark.chooseGroup": "Choisissez un groupe à mesurer.",
  "Benchmark.offline":
    "Il vous faut une connexion pour lancer le benchmark. La première étape télécharge le groupe.",
  "Benchmark.failed": "Échec : {measure}",
  "Benchmark.failOffline":
    "L’appareil s’est retrouvé hors ligne. Reconnectez-vous et relancez le test.",
  "Benchmark.failStorage":
    "Cet appareil n’a plus d’espace de stockage. Le groupe est peut-être trop volumineux pour lui.",
  "Benchmark.failServer": "Impossible de joindre le serveur. Réessayez.",
  "Benchmark.failBrowser":
    "Le navigateur a interrompu cette étape. Les détails figurent dans la ligne de résultats.",
  "Benchmark.failHidden":
    "Cet onglet est passé en arrière-plan : les images n’ont donc pas été comptées. Relancez le test avec l’onglet au premier plan.",
  "Benchmark.othersKept": "Les autres résultats sont conservés.",
  "Benchmark.noLargeTitle": "Aucun grand groupe pour l’instant",
  "Benchmark.noLargeBody": "Créez-en un avec le générateur, puis rechargez cette page :",
  "Benchmark.copyCommand": "Copier la commande",
  "Benchmark.noLargeFoot":
    "Les tailles et la façon de supprimer le groupe ensuite figurent dans docs/capacity.md.",
  "Benchmark.lastStoppedTitle": "Le dernier test s’est arrêté à l’étape « {measure} »",
  "Benchmark.lastStoppedBody":
    "L’onglet s’est fermé avant la fin du test, ce qui signifie généralement qu’il a manqué de mémoire ou d’espace de stockage. Groupe : {group}, démarré {time}.",
  "Benchmark.copyThatRun": "Copier les résultats de ce test",
  "Benchmark.dismiss": "Fermer",
  "Benchmark.doneSummary": "Terminé en {duration}. {count} mesures sur {total} dans l’objectif.",
  "Benchmark.partialSummary": "{count} mesures sur {total} effectuées.",
  "Benchmark.resultsCopied": "Résultats copiés",
  "Benchmark.commandCopied": "Commande copiée",
  "Benchmark.copyFailed": "Impossible de copier. Sélectionnez la ligne ci-dessous et copiez-la.",
  "Search.openBenchmark": "Ouvrir le benchmark",
  "Search.benchmarkDetail": "Mesurer les performances d’un grand groupe sur cet appareil",
  "Shortcuts.runBenchmark": "Lancer le benchmark",
  "Shortcuts.copyResults": "Copier les résultats",
} satisfies Catalog
