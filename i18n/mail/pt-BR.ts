import type { Catalog } from "@spy4x/platform/universal/i18n"

export default {
  "Mail.sentBy": "— Enviado por",
  "Mail.signIn": "Entrar",
  "Mail.openProfile": "Abrir seu perfil",
  "Mail.openGroup": "Abrir o grupo",
  "PasswordResetMail.subject": "Redefina sua senha",
  "PasswordResetMail.asked": "Alguém pediu para redefinir a senha da sua conta em {host}.",
  "PasswordResetMail.open": {
    "one": "Abra este link em até {count} minuto para escolher uma senha nova.",
    "many": "Abra este link em até {count} minutos para escolher uma senha nova.",
    "other": "Abra este link em até {count} minutos para escolher uma senha nova.",
  },
  "PasswordResetMail.button": "Escolher uma senha nova",
  "PasswordResetMail.once":
    "O link só funciona uma vez. Ao usá-lo, você sai da conta em todos os dispositivos.",
  "PasswordResetMail.ignore": "Se não foi você, ignore este e-mail. Sua senha continua a mesma.",
  "SignInLinkMail.subject": "Seu link para entrar em {host}",
  "SignInLinkMail.asked": "Alguém pediu para entrar em {host} com este e-mail em {when}.",
  "SignInLinkMail.open": {
    "one":
      "Abra este link em até {count} minuto para entrar. Se ainda não houver uma conta com este e-mail, ele cria uma.",
    "many":
      "Abra este link em até {count} minutos para entrar. Se ainda não houver uma conta com este e-mail, ele cria uma.",
    "other":
      "Abra este link em até {count} minutos para entrar. Se ainda não houver uma conta com este e-mail, ele cria uma.",
  },
  "SignInLinkMail.button": "Entrar em {host}",
  "SignInLinkMail.once":
    "O link só funciona uma vez. Ele abre uma página com o botão Continuar, e nada acontece até você clicar nele.",
  "SignInLinkMail.ignore":
    "Se não foi você, ignore este e-mail. Ninguém consegue entrar sem o link.",
  "EmailCodeMail.subject": "Seu código para confirmar o e-mail",
  "EmailCodeMail.asked": "Digite este código em {host} para confirmar seu e-mail.",
  "EmailCodeMail.valid": {
    "one": "Ele vale uma única vez, por {count} minuto.",
    "many": "Ele vale uma única vez, por {count} minutos.",
    "other": "Ele vale uma única vez, por {count} minutos.",
  },
  "EmailCodeMail.ignore": "Se não foi você, ignore este e-mail. Nada vai mudar.",
  "InvitationMail.subject": "Um convite para o grupo “{group}”",
  "InvitationMail.invited":
    "<strong>{who}</strong> convidou você para entrar no grupo “{group}” em {host} como {role}.",
  "InvitationMail.invitedNoName":
    "Você recebeu um convite para entrar no grupo “{group}” em {host} como {role}.",
  "InvitationMail.open": {
    "one": "Abra o convite em até {count} dia para aceitar ou recusar.",
    "many": "Abra o convite em até {count} dias para aceitar ou recusar.",
    "other": "Abra o convite em até {count} dias para aceitar ou recusar.",
  },
  "InvitationMail.button": "Abrir o convite",
  "InvitationMail.account":
    "O convite é para este e-mail, então aceite pela conta que usa este endereço.",
  "InvitationMail.ignore": "Se não quiser entrar, é só ignorar este e-mail.",
  "AccountDeletionMail.subject": "Sua conta será excluída em {date}",
  "AccountDeletionMail.asked":
    "Como você pediu, sua conta em {host} será excluída de vez em <strong>{date}</strong>.",
  "AccountDeletionMail.keep": "Mudou de ideia? Entre antes dessa data para manter sua conta.",
  "AccountDeletionMail.notYou":
    "Se não foi você, entre agora para manter sua conta e depois troque sua senha.",
  "AccountRestoredMail.subject": "Sua conta não será mais excluída",
  "AccountRestoredMail.restored":
    "Alguém entrou na sua conta em {host}, então ela não será mais excluída.",
  "AccountRestoredMail.notYou":
    "Se não foi você, entre, troque sua senha e peça a exclusão da conta de novo.",
  "DataExportReadyMail.subject": "Seus dados estão prontos",
  "DataExportReadyMail.ready": "Baixe pelo seu perfil até <strong>{date}</strong>.",
  "DataExportReadyMail.notYou":
    "Se não foi você, troque sua senha e saia da conta nos outros dispositivos.",
  "SignInMethodMail.passkeyAddedSubject": "Uma chave de acesso foi adicionada à sua conta",
  "SignInMethodMail.passkeyAdded":
    "Uma chave de acesso foi adicionada à sua conta em {host} em {when}. A partir de agora, ela pode ser usada para entrar.",
  "SignInMethodMail.passkeyAddedNotYou":
    "Se não foi você, remova a chave de acesso no seu perfil e troque sua senha.",
  "SignInMethodMail.passkeyRemovedSubject": "Uma chave de acesso foi removida da sua conta",
  "SignInMethodMail.passkeyRemoved":
    "Uma chave de acesso foi removida da sua conta em {host} em {when}. Ela não serve mais para entrar.",
  "SignInMethodMail.passkeyRemovedNotYou":
    "Se não foi você, entre, troque sua senha e adicione sua chave de acesso de novo.",
  "SignInMethodMail.linkedSubject": "{provider} foi vinculado à sua conta",
  "SignInMethodMail.linked":
    "{provider} foi vinculado à sua conta em {host} em {when}. Agora você pode entrar com ele.",
  "SignInMethodMail.linkedNotYou":
    "Se não foi você, desvincule {provider} no seu perfil e troque sua senha.",
  "SignInMethodMail.unlinkedSubject": "{provider} foi desvinculado da sua conta",
  "SignInMethodMail.unlinked":
    "{provider} foi desvinculado da sua conta em {host} em {when}. Você não pode mais entrar com ele.",
  "SignInMethodMail.unlinkedNotYou":
    "Se não foi você, entre, troque sua senha e vincule {provider} de novo.",
  "ApiTokenMail.subject": "Um novo token de API foi criado",
  "ApiTokenMail.created": "Um token de API chamado “{name}” foi criado para sua conta em {host}.",
  "ApiTokenMail.readUntil": "Ele pode ler o grupo “{group}” e expira em {date}.",
  "ApiTokenMail.readForever": "Ele pode ler o grupo “{group}” e não expira.",
  "ApiTokenMail.writeUntil": "Ele pode ler e alterar o grupo “{group}” e expira em {date}.",
  "ApiTokenMail.writeForever": "Ele pode ler e alterar o grupo “{group}” e não expira.",
  "ApiTokenMail.notYou":
    "Se não foi você, revogue o token no seu perfil e troque sua senha. Trocar a senha revoga todos os tokens de API.",
  "BillingNoticeMail.paidPlan": "pago",
  "BillingNoticeMail.trialSubject": "Seu teste grátis do plano {plan} termina em {date}",
  "BillingNoticeMail.trialWhat":
    "O teste grátis do plano {plan} no grupo “{group}” termina em <strong>{date}</strong>.",
  "BillingNoticeMail.trialWithCard":
    "Depois disso, a assinatura começa e o seu cartão é cobrado. Para evitar a cobrança, cancele antes dessa data na página do grupo.",
  "BillingNoticeMail.trialWithoutCard":
    "Para manter o plano, adicione um cartão na página do grupo antes dessa data. Aí a assinatura começa e o cartão é cobrado. Sem cartão, o grupo passa para o plano gratuito.",
  "BillingNoticeMail.paymentSubject": "Um pagamento do plano {plan} falhou",
  "BillingNoticeMail.paymentWhat": "Um pagamento do plano {plan} do grupo “{group}” falhou.",
  "BillingNoticeMail.paymentKept":
    "Você mantém o plano até <strong>{date}</strong> enquanto tentamos cobrar de novo. Para continuar com ele depois disso, atualize o cartão na página do grupo.",
  "BillingNoticeMail.paymentFree":
    "Agora o grupo está no plano gratuito. Para recuperar o plano, atualize o cartão na página do grupo.",
  "BillingNoticeMail.planSubject": "Seu plano {plan} termina em {date}",
  "BillingNoticeMail.planWhat":
    "O plano {plan} do grupo “{group}” foi cancelado e termina em <strong>{date}</strong>. Depois disso, o grupo passa para o plano gratuito.",
  "BillingNoticeMail.planNext": "Mudou de ideia? Renove na página do grupo antes dessa data.",
  "SubscriberConfirmMail.subject": "Confirme sua inscrição em {host}",
  "SubscriberConfirmMail.asked": "Alguém inscreveu este e-mail para receber novidades de {host}.",
  "SubscriberConfirmMail.within": "Confirme em até três dias para começar a receber.",
  "SubscriberConfirmMail.button": "Confirmar",
  "SubscriberConfirmMail.ignore":
    "Se não foi você, ignore este e-mail. Não vamos mandar nada para você.",
  "SubscriberWelcomeMail.subject": "Sua inscrição em {host} está confirmada",
  "SubscriberWelcomeMail.subscribed": "Pronto, você vai receber as novidades de {host}.",
  "SubscriberWelcomeMail.reason": "Você recebeu este e-mail porque se inscreveu em {host}.",
  "SubscriberWelcomeMail.unsubscribe": "Cancelar inscrição",
  "SubscriberIssue.reason": "Você recebeu este e-mail porque se inscreveu em {host}.",
  "SubscriberIssue.readPost": "Ler o post",
} satisfies Catalog
