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

| English                 | ru                        | es                          | de                       | pt-BR                             | ar                        | zh-CN           | ja                              | fr                        |
| ----------------------- | ------------------------- | --------------------------- | ------------------------ | --------------------------------- | ------------------------- | --------------- | ------------------------------- | ------------------------- |
| account                 | аккаунт                   | cuenta                      | Konto                    | conta                             | حساب                      | 账号            | アカウント                      | compte                    |
| sign in                 | войти / вход              | iniciar sesión              | anmelden / Anmeldung     | entrar                            | تسجيل الدخول              | 登录            | ログイン                        | se connecter / connexion  |
| sign out                | выйти                     | cerrar sesión               | abmelden                 | sair                              | تسجيل الخروج              | 退出登录        | ログアウト                      | se déconnecter            |
| sign up                 | зарегистрироваться        | registrarse                 | registrieren             | criar conta                       | إنشاء حساب                | 注册            | 新規登録                        | créer un compte           |
| username                | логин                     | nombre de usuario           | Benutzername             | nome de usuário                   | اسم المستخدم              | 用户名          | ユーザー名                      | nom d’utilisateur         |
| email                   | e-mail, почта             | correo electrónico          | E-Mail-Adresse           | e-mail                            | البريد الإلكتروني         | 邮箱            | メールアドレス                  | adresse e-mail            |
| password                | пароль                    | contraseña                  | Passwort                 | senha                             | كلمة المرور               | 密码            | パスワード                      | mot de passe              |
| passkey                 | ключ доступа              | llave de acceso             | Passkey                  | chave de acesso                   | مفتاح المرور              | 通行密钥        | パスキー                        | clé d’accès               |
| one-time code           | одноразовый код           | código de un solo uso       | Einmalcode               | código de uso único               | رمز لمرة واحدة            | 一次性验证码    | ワンタイムコード                | code à usage unique       |
| two-factor              | двухфакторная защита      | verificación en dos pasos   | Zwei-Faktor-Schutz       | verificação em duas etapas        | التحقق بخطوتين            | 双重验证        | 2段階認証                       | double authentification   |
| recovery codes          | резервные коды            | códigos de recuperación     | Wiederherstellungscodes  | códigos de recuperação            | رموز الاسترداد            | 恢复码          | リカバリーコード                | codes de récupération     |
| profile                 | профиль                   | perfil                      | Profil                   | perfil                            | الملف الشخصي              | 个人资料        | プロフィール                    | profil                    |
| settings                | настройки                 | ajustes                     | Einstellungen            | configurações                     | الإعدادات                 | 设置            | 設定                            | paramètres                |
| group                   | группа                    | grupo                       | Gruppe                   | grupo                             | مجموعة                    | 群组            | グループ                        | groupe                    |
| member                  | участник                  | miembro                     | Mitglied                 | membro                            | عضو                       | 成员            | メンバー                        | membre                    |
| owner (of a group)      | владелец                  | propietario                 | Inhaber                  | dono                              | المالك                    | 所有者          | オーナー                        | propriétaire              |
| role                    | роль                      | rol                         | Rolle                    | função                            | دور                       | 角色            | ロール                          | rôle                      |
| invitation              | приглашение               | invitación                  | Einladung                | convite                           | دعوة                      | 邀请            | 招待                            | invitation                |
| note                    | заметка                   | nota                        | Notiz                    | nota                              | ملاحظة                    | 笔记            | メモ                            | note                      |
| tag                     | метка                     | etiqueta                    | Tag                      | etiqueta                          | وسم                       | 标签            | タグ                            | étiquette                 |
| file / attachment       | файл                      | archivo                     | Datei                    | arquivo                           | ملف                       | 文件            | ファイル                        | fichier                   |
| device                  | устройство                | dispositivo                 | Gerät                    | dispositivo                       | جهاز                      | 设备            | デバイス                        | appareil                  |
| notification            | уведомление               | notificación                | Benachrichtigung         | notificação                       | إشعار                     | 通知            | 通知                            | notification              |
| plan                    | тариф                     | plan                        | Tarif                    | plano                             | خطة                       | 套餐            | プラン                          | forfait                   |
| free plan               | Бесплатный                | Gratis                      | Free                     | Gratuito                          | مجانية                    | 免费版          | 無料プラン                      | Gratuit                   |
| transfer (a group)      | передать                  | transferir                  | übertragen               | transferir                        | نقل                       | 转让            | 譲渡する                        | transférer                |
| link / unlink (account) | привязать / отвязать      | vincular / desvincular      | verknüpfen / trennen     | vincular / desvincular            | ربط / إلغاء الربط         | 关联 / 取消关联 | 連携 / 連携解除                 | associer / dissocier      |
| subscribe (newsletter)  | подписаться / отписаться  | suscribirse / darse de baja | abonnieren / abbestellen | inscrever-se / cancelar inscrição | الاشتراك / إلغاء الاشتراك | 订阅 / 退订     | 購読 / 購読解除                 | s’abonner / se désabonner |
| subscription / billing  | подписка / оплата         | suscripción / facturación   | Abo / Abrechnung         | assinatura / cobrança             | الاشتراك / الفوترة        | 订阅 / 账单     | サブスクリプション / 請求       | abonnement / facturation  |
| guest (account)         | гостевой аккаунт          | cuenta de invitado          | Gastkonto                | conta de visitante                | حساب ضيف                  | 访客账号        | ゲストアカウント                | compte invité             |
| demo data, sample data  | демо-данные               | datos de ejemplo            | Beispieldaten            | dados de exemplo                  | بيانات تجريبية            | 示例数据        | サンプルデータ                  | données d’exemple         |
| link (a URL)            | ссылка                    | enlace                      | Link                     | link                              | رابط                      | 链接            | リンク                          | lien                      |
| token (API)             | токен                     | token                       | das Token                | token                             | رمز مميز                  | 令牌            | トークン                        | jeton                     |
| operator (admin area)   | оператор                  | operador                    | Operator                 | operador                          | المشغّل                    | 运营人员        | オペレーター                    | opérateur                 |
| newsletter              | рассылка                  | boletín                     | Newsletter               | newsletter                        | النشرة البريدية           | 邮件简报        | ニュースレター                  | newsletter                |
| offline                 | офлайн, без сети          | sin conexión                | offline                  | offline                           | دون اتصال                 | 离线            | オフライン                      | hors ligne                |
| archive (verb / state)  | убрать в архив / в архиве | archivar / archivado        | archivieren / archiviert | arquivar / arquivado              | أرشفة / في الأرشيف        | 归档 / 已归档   | アーカイブする / アーカイブ済み | archiver / archivé        |
| delete (record)         | удалить                   | eliminar                    | löschen                  | excluir                           | حذف                       | 删除            | 削除                            | supprimer                 |
| remove (from a list)    | убрать                    | quitar                      | entfernen                | remover                           | إزالة                     | 移除            | 外す                            | retirer                   |
| restore                 | восстановить              | restaurar                   | wiederherstellen         | restaurar                         | استعادة                   | 恢复            | 復元                            | restaurer                 |
| upload                  | загрузить                 | subir                       | hochladen                | enviar                            | رفع                       | 上传            | アップロード                    | importer                  |
| sync                    | синхронизация             | sincronización              | Synchronisierung         | sincronização                     | المزامنة                  | 同步            | 同期                            | synchronisation           |
| conflict                | конфликт                  | conflicto                   | Konflikt                 | conflito                          | تعارض                     | 冲突            | 競合                            | conflit                   |
| theme                   | тема                      | tema                        | Design                   | tema                              | المظهر                    | 主题            | テーマ                          | thème                     |
| retry                   | повторить                 | reintentar                  | erneut versuchen         | tentar de novo                    | إعادة المحاولة            | 重试            | 再試行                          | réessayer                 |
| dismiss                 | скрыть / закрыть          | cerrar                      | schließen / ausblenden   | fechar                            | إخفاء                     | 关闭            | 閉じる                          | fermer                    |
| viewer (group role)     | читатель                  | lector                      | Betrachter               | leitor                            | قارئ                      | 查看者          | 閲覧者                          | lecteur                   |
| editor (group role)     | редактор                  | editor                      | Bearbeiter               | editor                            | محرر                      | 编辑者          | 編集者                          | éditeur                   |
| admin (group role)      | администратор             | administrador               | Admin                    | administrador                     | مسؤول                     | 管理员          | 管理者                          | administrateur            |
| session (signed-in)     | сеанс                     | sesión                      | Sitzung                  | sessão                            | جلسة                      | 会话            | セッション                      | session                   |
| audit log               | журнал аудита             | registro de auditoría       | Protokoll                | registro de auditoria             | سجل التدقيق               | 审计日志        | 監査ログ                        | journal d’audit           |
| job (background)        | задача                    | tarea                       | Job                      | tarefa                            | مهمة                      | 任务            | ジョブ                          | tâche                     |
| trial                   | пробный период            | prueba                      | Testphase                | teste                             | فترة تجريبية              | 试用期          | 無料トライアル                  | essai                     |
| past due                | просрочен                 | pago vencido                | überfällig               | em atraso                         | متأخر السداد              | 已逾期          | 支払い期限超過                  | impayé                    |
| refund                  | вернуть платёж            | reembolsar                  | erstatten                | reembolsar                        | استرداد المبلغ            | 退款            | 返金                            | rembourser                |
| revoke (token)          | отозвать                  | revocar                     | widerrufen               | revogar                           | إلغاء                     | 撤销            | 取り消す                        | révoquer                  |
| block (a person)        | заблокировать             | bloquear                    | sperren                  | bloquear                          | حظر                       | 封禁            | ブロック                        | bloquer                   |
| sign-in method          | способ входа              | método de inicio de sesión  | Anmeldemethode           | forma de entrar                   | طريقة تسجيل الدخول        | 登录方式        | ログイン方法                    | méthode de connexion      |
| trash                   | корзина                   | papelera                    | Papierkorb               | lixeira                           | سلة المهملات              | 回收站          | ゴミ箱                          | corbeille                 |

## Voice

Short, plain and friendly, as a person would say it, in the voice the components use:

| Language             | File       | Voice                                                                                       |
| -------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| German               | `de.ts`    | `du`, lower-case. "Versuche es noch einmal." An ellipsis follows a space: "Wird geladen …". |
| Spanish              | `es.ts`    | `tú`, neutral Spanish, gender-neutral where it costs nothing.                               |
| Brazilian Portuguese | `pt-BR.ts` | `você`. "Tente de novo."                                                                    |
| Russian              | `ru.ts`    | `вы`, lower-case. "Попробуйте ещё раз."                                                     |
| Arabic               | `ar.ts`    | Modern Standard Arabic, addressing the reader directly.                                     |
| French               | `fr.ts`    | `vous`. "Réessayez."                                                                        |
| Japanese             | `ja.ts`    | Polite です/ます form, no 「あなた」. "もう一度お試しください。"                            |
| Simplified Chinese   | `zh-CN.ts` | Mainland terms, `你`, plain and warm. "请重试。"                                            |

A button says what it does, as a verb. An error says what happened and what to do next. Use the
quotes of the language: „…“ in German, «…» in Spanish, Russian and Arabic, “…” in Brazilian
Portuguese and Simplified Chinese, «…» with non-breaking spaces inside in French, 「…」 in Japanese.
French puts a non-breaking space before `: ; ! ?`. Chinese and Japanese use full-width punctuation
(，。：！？) and no space between words; a Latin word or a `{placeholder}` inside the sentence takes
no added space either, except where the language's apps commonly put one.

The operator area (`admin`) speaks of the person whose account it shows in the third person.

## Terms kept in English

- The product's name (Seed), brand names, and file formats.
- Key names on the keyboard: Enter, Tab, Esc, Shift, Ctrl, Alt, Command.
- Offsets such as `GMT+2`.

## Length

The English length is the budget. Navigation entries (`Frame.overview` and its siblings) sit under
an icon in a 72 px rail: one word, about 12 characters. Buttons: about 1.5 times the English. Hints,
errors and announcements: no limit; say it fully.
