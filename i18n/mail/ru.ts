import type { Catalog } from "@spy4x/platform/universal/i18n"

export default {
  "Mail.sentBy": "— Письмо от",
  "Mail.signIn": "Войти",
  "Mail.openProfile": "Открыть профиль",
  "Mail.openGroup": "Открыть группу",
  "Mail.dontShare": "Никому не сообщайте этот код. {host} никогда его у вас не попросит.",
  "PasswordResetMail.subject": "Ваш код для сброса пароля",
  "PasswordResetMail.asked":
    "Кто-то попросил сбросить пароль вашего аккаунта на {host}. Введите этот код во вкладке, где вы его запросили:",
  "PasswordResetMail.valid": {
    "one":
      "Код одноразовый и действует {count} минуту. После сброса мы выведем вас из аккаунта на всех устройствах.",
    "few":
      "Код одноразовый и действует {count} минуты. После сброса мы выведем вас из аккаунта на всех устройствах.",
    "many":
      "Код одноразовый и действует {count} минут. После сброса мы выведем вас из аккаунта на всех устройствах.",
    "other":
      "Код одноразовый и действует {count} минуты. После сброса мы выведем вас из аккаунта на всех устройствах.",
  },
  "PasswordResetMail.ignore":
    "Если это были не вы, просто не обращайте внимания на письмо. Пароль останется прежним.",
  "PasswordResetNoticeMail.subject": "Сброс пароля",
  "PasswordResetNoticeMail.asked":
    "Команда {host} прислала вам это письмо, чтобы вы могли задать новый пароль для своего аккаунта.",
  "PasswordResetNoticeMail.how":
    "Откройте страницу по ссылке ниже и введите адрес этой почты. Мы пришлём на него код, и вы зададите новый пароль.",
  "PasswordResetNoticeMail.button": "Сбросить пароль",
  "PasswordResetNoticeMail.ignore":
    "Если новый пароль не нужен, просто не обращайте внимания на письмо. Пароль не изменится.",
  "SignInCodeMail.subject": "Ваш код для входа на {host}",
  "SignInCodeMail.asked":
    "{when} кто-то попросил войти на {host} с этой почтой. Введите этот код во вкладке, где вы его запросили:",
  "SignInCodeMail.valid": {
    "one":
      "Код одноразовый и действует {count} минуту. Если аккаунта с этой почтой ещё нет, он будет создан.",
    "few":
      "Код одноразовый и действует {count} минуты. Если аккаунта с этой почтой ещё нет, он будет создан.",
    "many":
      "Код одноразовый и действует {count} минут. Если аккаунта с этой почтой ещё нет, он будет создан.",
    "other":
      "Код одноразовый и действует {count} минуты. Если аккаунта с этой почтой ещё нет, он будет создан.",
  },
  "SignInCodeMail.ignore":
    "Если это были не вы, просто не обращайте внимания на письмо. Без кода никто не войдёт.",
  "EmailCodeMail.subject": "Код для подтверждения почты",
  "EmailCodeMail.asked": "Введите этот код на {host}, чтобы подтвердить почту.",
  "EmailCodeMail.valid": {
    "one": "Код одноразовый и действует {count} минуту.",
    "few": "Код одноразовый и действует {count} минуты.",
    "many": "Код одноразовый и действует {count} минут.",
    "other": "Код одноразовый и действует {count} минуты.",
  },
  "EmailCodeMail.ignore":
    "Если это были не вы, просто не обращайте внимания на письмо. Ничего не изменится.",
  "InvitationMail.subject": "Вас приглашают в группу «{group}»",
  "InvitationMail.invited":
    "<strong>{who}</strong> приглашает вас в группу «{group}» на {host} с ролью «{role}».",
  "InvitationMail.invitedNoName": "Вас приглашают в группу «{group}» на {host} с ролью «{role}».",
  "InvitationMail.open": {
    "one": "Приглашение действует {count} день: откройте его, чтобы принять или отклонить.",
    "few": "Приглашение действует {count} дня: откройте его, чтобы принять или отклонить.",
    "many": "Приглашение действует {count} дней: откройте его, чтобы принять или отклонить.",
    "other": "Приглашение действует {count} дня: откройте его, чтобы принять или отклонить.",
  },
  "InvitationMail.button": "Открыть приглашение",
  "InvitationMail.account":
    "Приглашение привязано к этой почте, поэтому примите его в аккаунте с этой почтой.",
  "InvitationMail.ignore": "Если не хотите вступать, просто не обращайте внимания на письмо.",
  "AccountDeletionMail.subject": "Ваш аккаунт будет удалён {date}",
  "AccountDeletionMail.asked":
    "Как вы и просили, ваш аккаунт на {host} будет удалён навсегда <strong>{date}</strong>.",
  "AccountDeletionMail.keep": "Передумали? Войдите до этого дня, и аккаунт останется.",
  "AccountDeletionMail.notYou":
    "Если это были не вы, войдите прямо сейчас, чтобы сохранить аккаунт, а потом смените пароль.",
  "AccountRestoredMail.subject": "Ваш аккаунт не будет удалён",
  "AccountRestoredMail.restored":
    "Кто-то вошёл в ваш аккаунт на {host}, поэтому удалять его мы не будем.",
  "AccountRestoredMail.notYou":
    "Если это были не вы, войдите, смените пароль и снова удалите аккаунт.",
  "DataExportReadyMail.subject": "Ваши данные готовы",
  "DataExportReadyMail.ready": "Скачать их можно в профиле до <strong>{date}</strong>.",
  "DataExportReadyMail.notYou":
    "Если вы их не запрашивали, смените пароль и выйдите из аккаунта на других устройствах.",
  "SignInMethodMail.passkeyAddedSubject": "В ваш аккаунт добавлен ключ доступа",
  "SignInMethodMail.passkeyAdded":
    "{when} к вашему аккаунту на {host} добавили ключ доступа. Теперь с ним можно входить.",
  "SignInMethodMail.passkeyAddedNotYou":
    "Если это были не вы, удалите ключ доступа в профиле и смените пароль.",
  "SignInMethodMail.passkeyRemovedSubject": "Из вашего аккаунта удалён ключ доступа",
  "SignInMethodMail.passkeyRemoved":
    "{when} из вашего аккаунта на {host} удалили ключ доступа. Войти с ним больше нельзя.",
  "SignInMethodMail.passkeyRemovedNotYou":
    "Если это были не вы, войдите, смените пароль и снова добавьте ключ доступа.",
  "SignInMethodMail.linkedSubject": "К вашему аккаунту привязан {provider}",
  "SignInMethodMail.linked":
    "{when} к вашему аккаунту на {host} привязали {provider}. Теперь через него можно входить.",
  "SignInMethodMail.linkedNotYou":
    "Если это были не вы, отвяжите {provider} в профиле и смените пароль.",
  "SignInMethodMail.unlinkedSubject": "От вашего аккаунта отвязан {provider}",
  "SignInMethodMail.unlinked":
    "{when} от вашего аккаунта на {host} отвязали {provider}. Войти через него больше нельзя.",
  "SignInMethodMail.unlinkedNotYou":
    "Если это были не вы, войдите, смените пароль и снова привяжите {provider}.",
  "ApiTokenMail.subject": "Создан новый API-токен",
  "ApiTokenMail.created": "Для вашего аккаунта на {host} создан API-токен «{name}».",
  "ApiTokenMail.readUntil": "Он может читать группу «{group}» и действует до {date}.",
  "ApiTokenMail.readForever": "Он может читать группу «{group}» и действует бессрочно.",
  "ApiTokenMail.writeUntil": "Он может читать и изменять группу «{group}» и действует до {date}.",
  "ApiTokenMail.writeForever": "Он может читать и изменять группу «{group}» и действует бессрочно.",
  "ApiTokenMail.notYou":
    "Если это были не вы, отзовите токен в профиле и смените пароль. При смене пароля отзываются все API-токены.",
  "BillingNoticeMail.paidPlan": "платный",
  "BillingNoticeMail.trialSubject": "Пробный период тарифа {plan} закончится {date}",
  "BillingNoticeMail.trialWhat":
    "Пробный период тарифа {plan} для группы «{group}» закончится <strong>{date}</strong>.",
  "BillingNoticeMail.trialWithCard":
    "После этого начнётся подписка и с карты спишется оплата. Чтобы этого не случилось, отмените подписку на странице группы до этой даты.",
  "BillingNoticeMail.trialWithoutCard":
    "Чтобы остаться на тарифе, добавьте карту на странице группы до этой даты. Тогда начнётся подписка и с карты спишется оплата. Без карты группа перейдёт на бесплатный тариф.",
  "BillingNoticeMail.paymentSubject": "Не прошла оплата тарифа {plan}",
  "BillingNoticeMail.paymentWhat": "Не прошла оплата тарифа {plan} для группы «{group}».",
  "BillingNoticeMail.paymentKept":
    "Тариф сохранится до <strong>{date}</strong>, пока мы пробуем списать оплату снова. Чтобы он остался и дальше, обновите карту на странице группы.",
  "BillingNoticeMail.paymentFree":
    "Группа перешла на бесплатный тариф. Чтобы вернуть прежний, обновите карту на странице группы.",
  "BillingNoticeMail.planSubject": "Ваш тариф {plan} закончится {date}",
  "BillingNoticeMail.planWhat":
    "Тариф {plan} для группы «{group}» отменён и закончится <strong>{date}</strong>. После этого группа перейдёт на бесплатный тариф.",
  "BillingNoticeMail.planNext": "Передумали? Продлите его на странице группы до этой даты.",
  "SubscriberConfirmMail.subject": "Подтвердите подписку на {host}",
  "SubscriberConfirmMail.asked": "Кто-то подписал эту почту на новости {host}.",
  "SubscriberConfirmMail.within": "Подтвердите подписку в течение трёх дней, чтобы получать их.",
  "SubscriberConfirmMail.button": "Подтвердить",
  "SubscriberConfirmMail.ignore":
    "Если это были не вы, просто не обращайте внимания на письмо. Мы ничего не будем вам присылать.",
  "SubscriberWelcomeMail.subject": "Вы подписались на {host}",
  "SubscriberWelcomeMail.subscribed": "Вы подписались на новости {host}.",
  "SubscriberWelcomeMail.reason": "Вы получили это письмо, потому что подписались на {host}.",
  "SubscriberWelcomeMail.unsubscribe": "Отписаться",
  "SubscriberIssue.reason": "Вы получили это письмо, потому что подписались на {host}.",
  "SubscriberIssue.readPost": "Читать пост",
} satisfies Catalog
