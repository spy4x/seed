# Translating

Every word Seed's own screens show lives in a catalog: `i18n/<namespace>/<language>.ts`, with
`en.ts` as the source. Each catalog is a TypeScript module, `export default { … } satisfies
Catalog`, with its keys and messages in double quotes. The components of preact-components bring
their own catalogs; this folder holds only Seed's words.

| Namespace | What it holds                                                   | Loaded by      |
| --------- | --------------------------------------------------------------- | -------------- |
| `app`     | The product's screens (the SPA)                                 | the SPA        |
| `admin`   | The operator area                                               | the admin app  |
| `site`    | The public website (#276)                                       | the MPA        |
| `mail`    | E-mails (#277)                                                  | the worker     |
| `errors`  | The API's error codes, keyed by code, shown by both apps (#275) | the SPA, admin |

The languages are `LANGUAGES` in `libs/domain/identity/preferences.ts`. Adding one is an entry
there, a file per namespace here, and in each app a module listing its catalogs
(`apps/spa/src/i18n/<language>.ts`, `apps/admin/src/i18n/<language>.ts`) with a loader line for it
in `apps/spa/src/i18n.ts` and `apps/admin/src/i18n.ts`.

A key is `<Component>.<field>`, such as `Frame.signOut`. Keys are unique across namespaces: one
translator holds them all. Code names every key as a quoted literal, so the check below can tell
when a key is no longer used.

A `{name}` in a message is a value the code fills in: keep every one, spelled the same. `<value>…</value>`
marks a span the code draws, such as a link; keep the tags around the same words. A message that is
an object (`{ "one": …, "other": … }`) is a plural, with one form per plural category of the
language.

## The loop

1. Change the English in `en.ts`, and name the key in the code.
2. Run `deno task test`. `i18n/i18n.test.ts` lists every message that is missing, extra, empty, or
   out of date because its English changed, every one whose placeholders, tags or plural forms
   differ from the English, and every English key no code names.
3. Translate what it lists, in every language.
4. Run `deno task i18n:stamp`. It records in `<language>.lock` which English each translation was
   made from.
5. Run `deno task test` again. It passes once every language matches the English.

Stamp only after the translation is done: a stamp tells the test that the translation is current.

## How to translate

Translate the situation, not the words. A translation made key by key from the catalog alone reads
like a machine made it, so:

1. Before translating a key, find where the code uses it (search for the quoted key) and read that
   screen or component: what the text sits next to (a button, a heading, a hint under a field, a
   toast) and what happens when a person acts on it.
2. Write what a native copywriter of the language would put in a modern, friendly app: natural word
   order, the phrasing well-known apps in that language use, no calques, no impersonal or
   bureaucratic passives, no literal noun chains.
3. Use the glossary below: one term per thing, on every screen.
4. Re-read the whole file as a user would, screen by screen, and fix anything that sounds
   translated.
5. A translation is done by an agent or person whose only task is that language, never as a side
   task of a code change. A change that adds or edits English leaves the other languages to that
   pass.
6. A second reader checks every new translation: the owner for Russian, and for the other
   languages a separate agent that translates it back to English and compares the meaning with
   the source.

## Glossary

One word for one thing, on every screen. Translate a term the same way everywhere, unless the
sentence needs another grammatical form of it.

| English                 | ru                        | es                          | de                       | pt-BR                             | ar                        |
| ----------------------- | ------------------------- | --------------------------- | ------------------------ | --------------------------------- | ------------------------- |
| account                 | аккаунт                   | cuenta                      | Konto                    | conta                             | حساب                      |
| sign in                 | войти / вход              | iniciar sesión              | anmelden / Anmeldung     | entrar                            | تسجيل الدخول              |
| sign out                | выйти                     | cerrar sesión               | abmelden                 | sair                              | تسجيل الخروج              |
| sign up                 | зарегистрироваться        | registrarse                 | registrieren             | criar conta                       | إنشاء حساب                |
| username                | логин                     | nombre de usuario           | Benutzername             | nome de usuário                   | اسم المستخدم              |
| email                   | e-mail, почта             | correo electrónico          | E-Mail-Adresse           | e-mail                            | البريد الإلكتروني         |
| password                | пароль                    | contraseña                  | Passwort                 | senha                             | كلمة المرور               |
| passkey                 | ключ доступа              | llave de acceso             | Passkey                  | chave de acesso                   | مفتاح المرور              |
| one-time code           | одноразовый код           | código de un solo uso       | Einmalcode               | código de uso único               | رمز لمرة واحدة            |
| two-factor              | двухфакторная защита      | verificación en dos pasos   | Zwei-Faktor-Schutz       | verificação em duas etapas        | التحقق بخطوتين            |
| recovery codes          | резервные коды            | códigos de recuperación     | Wiederherstellungscodes  | códigos de recuperação            | رموز الاسترداد            |
| profile                 | профиль                   | perfil                      | Profil                   | perfil                            | الملف الشخصي              |
| settings                | настройки                 | ajustes                     | Einstellungen            | configurações                     | الإعدادات                 |
| group                   | группа                    | grupo                       | Gruppe                   | grupo                             | مجموعة                    |
| member                  | участник                  | miembro                     | Mitglied                 | membro                            | عضو                       |
| owner (of a group)      | владелец                  | propietario                 | Inhaber                  | dono                              | المالك                    |
| role                    | роль                      | rol                         | Rolle                    | função                            | دور                       |
| invitation              | приглашение               | invitación                  | Einladung                | convite                           | دعوة                      |
| note                    | заметка                   | nota                        | Notiz                    | nota                              | ملاحظة                    |
| tag                     | метка                     | etiqueta                    | Tag                      | etiqueta                          | وسم                       |
| file / attachment       | файл                      | archivo                     | Datei                    | arquivo                           | ملف                       |
| device                  | устройство                | dispositivo                 | Gerät                    | dispositivo                       | جهاز                      |
| notification            | уведомление               | notificación                | Benachrichtigung         | notificação                       | إشعار                     |
| plan                    | тариф                     | plan                        | Tarif                    | plano                             | خطة                       |
| free plan               | Бесплатный                | Gratis                      | Free                     | Gratuito                          | مجانية                    |
| transfer (a group)      | передать                  | transferir                  | übertragen               | transferir                        | نقل                       |
| link / unlink (account) | привязать / отвязать      | vincular / desvincular      | verknüpfen / trennen     | vincular / desvincular            | ربط / إلغاء الربط         |
| subscribe (newsletter)  | подписаться / отписаться  | suscribirse / darse de baja | abonnieren / abbestellen | inscrever-se / cancelar inscrição | الاشتراك / إلغاء الاشتراك |
| subscription / billing  | подписка / оплата         | suscripción / facturación   | Abo / Abrechnung         | assinatura / cobrança             | الاشتراك / الفوترة        |
| guest (account)         | гостевой аккаунт          | cuenta de invitado          | Gastkonto                | conta de visitante                | حساب ضيف                  |
| demo data, sample data  | демо-данные               | datos de ejemplo            | Beispieldaten            | dados de exemplo                  | بيانات تجريبية            |
| link (a URL)            | ссылка                    | enlace                      | Link                     | link                              | رابط                      |
| token (API)             | токен                     | token                       | das Token                | token                             | رمز مميز                  |
| operator (admin area)   | оператор                  | operador                    | Operator                 | operador                          | المشغّل                    |
| newsletter              | рассылка                  | boletín                     | Newsletter               | newsletter                        | النشرة البريدية           |
| offline                 | офлайн, без сети          | sin conexión                | offline                  | offline                           | دون اتصال                 |
| archive (verb / state)  | убрать в архив / в архиве | archivar / archivado        | archivieren / archiviert | arquivar / arquivado              | أرشفة / في الأرشيف        |
| delete (record)         | удалить                   | eliminar                    | löschen                  | excluir                           | حذف                       |
| remove (from a list)    | убрать                    | quitar                      | entfernen                | remover                           | إزالة                     |
| restore                 | восстановить              | restaurar                   | wiederherstellen         | restaurar                         | استعادة                   |
| upload                  | загрузить                 | subir                       | hochladen                | enviar                            | رفع                       |
| sync                    | синхронизация             | sincronización              | Synchronisierung         | sincronização                     | المزامنة                  |
| conflict                | конфликт                  | conflicto                   | Konflikt                 | conflito                          | تعارض                     |
| theme                   | тема                      | tema                        | Design                   | tema                              | المظهر                    |
| retry                   | повторить                 | reintentar                  | erneut versuchen         | tentar de novo                    | إعادة المحاولة            |
| dismiss                 | скрыть / закрыть          | cerrar                      | schließen / ausblenden   | fechar                            | إخفاء                     |
| viewer (group role)     | читатель                  | lector                      | Betrachter               | leitor                            | قارئ                      |
| editor (group role)     | редактор                  | editor                      | Bearbeiter               | editor                            | محرر                      |
| admin (group role)      | администратор             | administrador               | Admin                    | administrador                     | مسؤول                     |
| session (signed-in)     | сеанс                     | sesión                      | Sitzung                  | sessão                            | جلسة                      |
| audit log               | журнал аудита             | registro de auditoría       | Protokoll                | registro de auditoria             | سجل التدقيق               |
| job (background)        | задача                    | tarea                       | Job                      | tarefa                            | مهمة                      |
| trial                   | пробный период            | prueba                      | Testphase                | teste                             | فترة تجريبية              |
| past due                | просрочен                 | pago vencido                | überfällig               | em atraso                         | متأخر السداد              |
| refund                  | вернуть платёж            | reembolsar                  | erstatten                | reembolsar                        | استرداد المبلغ            |
| revoke (token)          | отозвать                  | revocar                     | widerrufen               | revogar                           | إلغاء                     |
| block (a person)        | заблокировать             | bloquear                    | sperren                  | bloquear                          | حظر                       |
| sign-in method          | способ входа              | método de inicio de sesión  | Anmeldemethode           | forma de entrar                   | طريقة تسجيل الدخول        |
| trash                   | корзина                   | papelera                    | Papierkorb               | lixeira                           | سلة المهملات              |

## Voice

Short, plain and friendly, as a person would say it, in the voice the components use:

| Language             | File       | Voice                                                                                       |
| -------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| German               | `de.ts`    | `du`, lower-case. "Versuche es noch einmal." An ellipsis follows a space: "Wird geladen …". |
| Spanish              | `es.ts`    | `tú`, neutral Spanish, gender-neutral where it costs nothing.                               |
| Brazilian Portuguese | `pt-BR.ts` | `você`. "Tente de novo."                                                                    |
| Russian              | `ru.ts`    | `вы`, lower-case. "Попробуйте ещё раз."                                                     |
| Arabic               | `ar.ts`    | Modern Standard Arabic, addressing the reader directly.                                     |

A button says what it does, as a verb. An error says what happened and what to do next. Use the
quotes of the language: „…“ in German, «…» in Spanish, Russian and Arabic, “…” in Brazilian
Portuguese. The operator area (`admin`) speaks of the person whose account it shows in the third
person.

## Terms kept in English

- The product's name (Seed), brand names, and file formats.
- Key names on the keyboard: Enter, Tab, Esc, Shift, Ctrl, Alt, Command.
- Offsets such as `GMT+2`.

## Length

The English length is the budget. Navigation entries (`Frame.overview` and its siblings) sit under
an icon in a 72 px rail: one word, about 12 characters. Buttons: about 1.5 times the English. Hints,
errors and announcements: no limit; say it fully.
