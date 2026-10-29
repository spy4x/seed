import type { Catalog } from "@spy4x/platform/universal/i18n"

export default {
  "Mail.sentBy": "— Enviado por",
  "Mail.signIn": "Iniciar sesión",
  "Mail.openProfile": "Abrir tu perfil",
  "Mail.openGroup": "Abrir el grupo",
  "PasswordResetMail.subject": "Restablece tu contraseña",
  "PasswordResetMail.asked": "Alguien pidió restablecer la contraseña de tu cuenta en {host}.",
  "PasswordResetMail.open": {
    "one": "Abre este enlace en menos de {count} minuto para elegir una contraseña nueva.",
    "many": "Abre este enlace en menos de {count} minutos para elegir una contraseña nueva.",
    "other": "Abre este enlace en menos de {count} minutos para elegir una contraseña nueva.",
  },
  "PasswordResetMail.button": "Elegir una contraseña nueva",
  "PasswordResetMail.once":
    "El enlace solo funciona una vez. Al usarlo, se cerrará tu sesión en todos tus dispositivos.",
  "PasswordResetMail.ignore":
    "Si no lo pediste tú, ignora este correo. Tu contraseña seguirá siendo la misma.",
  "SignInLinkMail.subject": "Tu enlace para iniciar sesión en {host}",
  "SignInLinkMail.asked":
    "Alguien pidió iniciar sesión en {host} con este correo electrónico el {when}.",
  "SignInLinkMail.open": {
    "one":
      "Abre este enlace en menos de {count} minuto para iniciar sesión. Si aún no hay una cuenta con este correo, se creará una.",
    "many":
      "Abre este enlace en menos de {count} minutos para iniciar sesión. Si aún no hay una cuenta con este correo, se creará una.",
    "other":
      "Abre este enlace en menos de {count} minutos para iniciar sesión. Si aún no hay una cuenta con este correo, se creará una.",
  },
  "SignInLinkMail.button": "Iniciar sesión en {host}",
  "SignInLinkMail.once":
    "El enlace solo funciona una vez. Abre una página con un botón «Continuar» y no pasa nada hasta que lo pulses.",
  "SignInLinkMail.ignore":
    "Si no lo pediste tú, ignora este correo. Nadie puede iniciar sesión sin el enlace.",
  "EmailCodeMail.subject": "Tu código para confirmar tu correo electrónico",
  "EmailCodeMail.asked": "Escribe este código en {host} para confirmar tu correo electrónico.",
  "EmailCodeMail.valid": {
    "one": "Solo sirve una vez y caduca en {count} minuto.",
    "many": "Solo sirve una vez y caduca en {count} minutos.",
    "other": "Solo sirve una vez y caduca en {count} minutos.",
  },
  "EmailCodeMail.ignore": "Si no lo pediste tú, ignora este correo. No cambiará nada.",
  "InvitationMail.subject": "Te invitaron a unirte a «{group}»",
  "InvitationMail.invited":
    "<strong>{who}</strong> te invitó a unirte a «{group}» en {host} con el rol de {role}.",
  "InvitationMail.invitedNoName":
    "Te invitaron a unirte a «{group}» en {host} con el rol de {role}.",
  "InvitationMail.open": {
    "one": "Abre la invitación en menos de {count} día para aceptarla o rechazarla.",
    "many": "Abre la invitación en menos de {count} días para aceptarla o rechazarla.",
    "other": "Abre la invitación en menos de {count} días para aceptarla o rechazarla.",
  },
  "InvitationMail.button": "Ver la invitación",
  "InvitationMail.account":
    "La invitación es para este correo electrónico, así que acéptala desde la cuenta que lo usa.",
  "InvitationMail.ignore": "Si no quieres unirte, simplemente ignora este correo.",
  "AccountDeletionMail.subject": "Tu cuenta se eliminará el {date}",
  "AccountDeletionMail.asked":
    "Como pediste, tu cuenta en {host} se eliminará para siempre el <strong>{date}</strong>.",
  "AccountDeletionMail.keep":
    "¿Cambiaste de opinión? Inicia sesión antes de esa fecha y conservarás tu cuenta.",
  "AccountDeletionMail.notYou":
    "Si no lo pediste tú, inicia sesión ahora para conservar tu cuenta y luego cambia tu contraseña.",
  "AccountRestoredMail.subject": "Tu cuenta ya no se eliminará",
  "AccountRestoredMail.restored":
    "Alguien inició sesión en tu cuenta de {host}, así que al final no se eliminará.",
  "AccountRestoredMail.notYou":
    "Si no fuiste tú, inicia sesión, cambia tu contraseña y vuelve a eliminar tu cuenta.",
  "DataExportReadyMail.subject": "Tus datos están listos",
  "DataExportReadyMail.ready": "Descárgalos desde tu perfil antes del <strong>{date}</strong>.",
  "DataExportReadyMail.notYou":
    "Si no lo pediste tú, cambia tu contraseña y cierra sesión en tus otros dispositivos.",
  "SignInMethodMail.passkeyAddedSubject": "Se añadió una llave de acceso a tu cuenta",
  "SignInMethodMail.passkeyAdded":
    "Se añadió una llave de acceso a tu cuenta de {host} el {when}. Desde ahora puedes usarla para iniciar sesión.",
  "SignInMethodMail.passkeyAddedNotYou":
    "Si no fuiste tú, quita la llave de acceso desde tu perfil y cambia tu contraseña.",
  "SignInMethodMail.passkeyRemovedSubject": "Se quitó una llave de acceso de tu cuenta",
  "SignInMethodMail.passkeyRemoved":
    "Se quitó una llave de acceso de tu cuenta de {host} el {when}. Ya no sirve para iniciar sesión.",
  "SignInMethodMail.passkeyRemovedNotYou":
    "Si no fuiste tú, inicia sesión, cambia tu contraseña y vuelve a añadir tu llave de acceso.",
  "SignInMethodMail.linkedSubject": "Se vinculó {provider} a tu cuenta",
  "SignInMethodMail.linked":
    "Se vinculó {provider} a tu cuenta de {host} el {when}. Desde ahora puedes iniciar sesión con él.",
  "SignInMethodMail.linkedNotYou":
    "Si no fuiste tú, desvincula {provider} desde tu perfil y cambia tu contraseña.",
  "SignInMethodMail.unlinkedSubject": "Se desvinculó {provider} de tu cuenta",
  "SignInMethodMail.unlinked":
    "Se desvinculó {provider} de tu cuenta de {host} el {when}. Ya no puedes iniciar sesión con él.",
  "SignInMethodMail.unlinkedNotYou":
    "Si no fuiste tú, inicia sesión, cambia tu contraseña y vuelve a vincular {provider}.",
  "ApiTokenMail.subject": "Se creó un token de API nuevo",
  "ApiTokenMail.created": "Se creó un token de API llamado «{name}» para tu cuenta de {host}.",
  "ApiTokenMail.readUntil": "Puede ver el grupo «{group}» y caduca el {date}.",
  "ApiTokenMail.readForever": "Puede ver el grupo «{group}» y no caduca nunca.",
  "ApiTokenMail.writeUntil": "Puede ver y modificar el grupo «{group}» y caduca el {date}.",
  "ApiTokenMail.writeForever": "Puede ver y modificar el grupo «{group}» y no caduca nunca.",
  "ApiTokenMail.notYou":
    "Si no fuiste tú, revoca el token desde tu perfil y cambia tu contraseña. Al cambiarla, se revocan todos los tokens de API.",
  "BillingNoticeMail.paidPlan": "de pago",
  "BillingNoticeMail.trialSubject": "La prueba del plan {plan} termina el {date}",
  "BillingNoticeMail.trialWhat":
    "La prueba del plan {plan} de «{group}» termina el <strong>{date}</strong>.",
  "BillingNoticeMail.trialWithCard":
    "Después empieza la suscripción y se hará el cargo en tu tarjeta. Si no la quieres, cancélala antes en la página del grupo.",
  "BillingNoticeMail.trialWithoutCard":
    "Para mantener el plan, añade una tarjeta en la página del grupo antes de esa fecha. Entonces empezará la suscripción y se hará el cargo en tu tarjeta. Sin tarjeta, el grupo pasará al plan gratuito.",
  "BillingNoticeMail.paymentSubject": "No se pudo cobrar el plan {plan}",
  "BillingNoticeMail.paymentWhat": "No se pudo cobrar el pago del plan {plan} de «{group}».",
  "BillingNoticeMail.paymentKept":
    "Mantienes el plan hasta el <strong>{date}</strong> mientras volvemos a intentar el cobro. Para conservarlo después, actualiza la tarjeta en la página del grupo.",
  "BillingNoticeMail.paymentFree":
    "El grupo pasó al plan gratuito. Para recuperar el plan, actualiza la tarjeta en la página del grupo.",
  "BillingNoticeMail.planSubject": "Tu plan {plan} termina el {date}",
  "BillingNoticeMail.planWhat":
    "El plan {plan} de «{group}» se canceló y termina el <strong>{date}</strong>. Después, el grupo pasará al plan gratuito.",
  "BillingNoticeMail.planNext":
    "¿Cambiaste de opinión? Renuévalo en la página del grupo antes de esa fecha.",
  "SubscriberConfirmMail.subject": "Confirma tu suscripción a {host}",
  "SubscriberConfirmMail.asked":
    "Alguien suscribió este correo electrónico a las novedades de {host}.",
  "SubscriberConfirmMail.within": "Confírmalo en los próximos tres días para empezar a recibirlas.",
  "SubscriberConfirmMail.button": "Confirmar",
  "SubscriberConfirmMail.ignore": "Si no lo pediste tú, ignora este correo. No te enviaremos nada.",
  "SubscriberWelcomeMail.subject": "Tu suscripción a {host} está activa",
  "SubscriberWelcomeMail.subscribed": "A partir de ahora recibirás las novedades de {host}.",
  "SubscriberWelcomeMail.reason": "Recibes este correo porque te suscribiste en {host}.",
  "SubscriberWelcomeMail.unsubscribe": "Darme de baja",
  "SubscriberIssue.reason": "Recibes este correo porque te suscribiste en {host}.",
  "SubscriberIssue.readPost": "Leer el artículo",
} satisfies Catalog
