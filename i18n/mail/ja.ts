import type { Catalog } from "@spy4x/platform/universal/i18n"

export default {
  "Mail.sentBy": "— 送信元：",
  "Mail.signIn": "ログイン",
  "Mail.openProfile": "プロフィールを開く",
  "Mail.openGroup": "グループを開く",
  "PasswordResetMail.subject": "パスワードの再設定",
  "PasswordResetMail.asked": "{host}のアカウントで、パスワードの再設定がリクエストされました。",
  "PasswordResetMail.open": {
    "other": "{count}分以内にこのリンクを開いて、新しいパスワードを設定してください。",
  },
  "PasswordResetMail.button": "新しいパスワードを設定",
  "PasswordResetMail.once":
    "このリンクは1回だけ使えます。使うと、すべてのデバイスからログアウトします。",
  "PasswordResetMail.ignore":
    "お心当たりがない場合は、このメールを無視してください。パスワードは変更されません。",
  "SignInLinkMail.subject": "{host}のログインリンク",
  "SignInLinkMail.asked":
    "{when}に、このメールアドレスで{host}へのログインがリクエストされました。",
  "SignInLinkMail.open": {
    "other":
      "{count}分以内にこのリンクを開いてログインしてください。このメールアドレスのアカウントがまだない場合は、新しく作成されます。",
  },
  "SignInLinkMail.button": "{host}にログイン",
  "SignInLinkMail.once":
    "このリンクは1回だけ使えます。開くと「続行」ボタンのあるページが表示され、ボタンを押すまでは何も起こりません。",
  "SignInLinkMail.ignore":
    "お心当たりがない場合は、このメールを無視してください。リンクがなければ誰もログインできません。",
  "EmailCodeMail.subject": "メールアドレス確認用のコード",
  "EmailCodeMail.asked": "メールアドレスを確認するには、{host}でこのコードを入力してください。",
  "EmailCodeMail.valid": {
    "other": "コードは1回だけ、{count}分間有効です。",
  },
  "EmailCodeMail.ignore":
    "お心当たりがない場合は、このメールを無視してください。何も変更されません。",
  "InvitationMail.subject": "「{group}」への招待が届いています",
  "InvitationMail.invited":
    "<strong>{who}</strong>さんから、{host}の「{group}」に{role}として招待されました。",
  "InvitationMail.invitedNoName": "{host}の「{group}」に{role}として招待されました。",
  "InvitationMail.open": {
    "other": "{count}日以内に招待を開いて、参加するか辞退するかを選んでください。",
  },
  "InvitationMail.button": "招待を開く",
  "InvitationMail.account":
    "この招待はこのメールアドレス宛てです。このメールアドレスを使っているアカウントで承認してください。",
  "InvitationMail.ignore": "参加しない場合は、このメールを無視してください。",
  "AccountDeletionMail.subject": "アカウントは{date}に削除されます",
  "AccountDeletionMail.asked":
    "ご依頼どおり、{host}のアカウントは<strong>{date}</strong>に完全に削除されます。",
  "AccountDeletionMail.keep":
    "気が変わりましたか？それまでにログインすれば、アカウントはそのまま残ります。",
  "AccountDeletionMail.notYou":
    "お心当たりがない場合は、今すぐログインしてアカウントを残し、パスワードを変更してください。",
  "AccountRestoredMail.subject": "アカウントの削除は取り消されました",
  "AccountRestoredMail.restored":
    "{host}のアカウントにログインがあったため、アカウントは削除されなくなりました。",
  "AccountRestoredMail.notYou":
    "ご自身でない場合は、ログインしてパスワードを変更し、もう一度アカウントを削除してください。",
  "DataExportReadyMail.subject": "データの準備ができました",
  "DataExportReadyMail.ready":
    "<strong>{date}</strong>まで、プロフィールからダウンロードできます。",
  "DataExportReadyMail.notYou":
    "お心当たりがない場合は、パスワードを変更し、ほかのデバイスからログアウトしてください。",
  "SignInMethodMail.passkeyAddedSubject": "アカウントにパスキーが追加されました",
  "SignInMethodMail.passkeyAdded":
    "{when}に、{host}のアカウントにパスキーが追加されました。今後はこのパスキーでログインできます。",
  "SignInMethodMail.passkeyAddedNotYou":
    "ご自身でない場合は、プロフィールでパスキーを削除し、パスワードを変更してください。",
  "SignInMethodMail.passkeyRemovedSubject": "アカウントからパスキーが削除されました",
  "SignInMethodMail.passkeyRemoved":
    "{when}に、{host}のアカウントからパスキーが削除されました。このパスキーではもうログインできません。",
  "SignInMethodMail.passkeyRemovedNotYou":
    "ご自身でない場合は、ログインしてパスワードを変更し、パスキーをもう一度追加してください。",
  "SignInMethodMail.linkedSubject": "アカウントに{provider}が連携されました",
  "SignInMethodMail.linked":
    "{when}に、{host}のアカウントに{provider}が連携されました。今後はこの方法でもログインできます。",
  "SignInMethodMail.linkedNotYou":
    "ご自身でない場合は、プロフィールで{provider}の連携を解除し、パスワードを変更してください。",
  "SignInMethodMail.unlinkedSubject": "アカウントと{provider}の連携が解除されました",
  "SignInMethodMail.unlinked":
    "{when}に、{host}のアカウントと{provider}の連携が解除されました。今後はこの方法ではログインできません。",
  "SignInMethodMail.unlinkedNotYou":
    "ご自身でない場合は、ログインしてパスワードを変更し、{provider}をもう一度連携してください。",
  "ApiTokenMail.subject": "新しいAPIトークンが作成されました",
  "ApiTokenMail.created":
    "{host}のアカウントで、「{name}」という名前のAPIトークンが作成されました。",
  "ApiTokenMail.readUntil":
    "このトークンはグループ「{group}」を閲覧でき、{date}に期限切れになります。",
  "ApiTokenMail.readForever": "このトークンはグループ「{group}」を閲覧でき、有効期限はありません。",
  "ApiTokenMail.writeUntil":
    "このトークンはグループ「{group}」を閲覧・変更でき、{date}に期限切れになります。",
  "ApiTokenMail.writeForever":
    "このトークンはグループ「{group}」を閲覧・変更でき、有効期限はありません。",
  "ApiTokenMail.notYou":
    "ご自身でない場合は、プロフィールでトークンを取り消し、パスワードを変更してください。パスワードを変更すると、すべてのAPIトークンが取り消されます。",
  "BillingNoticeMail.paidPlan": "有料",
  "BillingNoticeMail.trialSubject": "{plan}プランの無料トライアルは{date}に終了します",
  "BillingNoticeMail.trialWhat":
    "「{group}」の{plan}プランの無料トライアルは<strong>{date}</strong>に終了します。",
  "BillingNoticeMail.trialWithCard":
    "終了後はサブスクリプションが始まり、カードに請求されます。止めるには、それまでにグループのページで解約してください。",
  "BillingNoticeMail.trialWithoutCard":
    "プランを続けるには、それまでにグループのページでカードを登録してください。登録するとサブスクリプションが始まり、カードに請求されます。カードを登録しない場合、グループは無料プランに切り替わります。",
  "BillingNoticeMail.paymentSubject": "{plan}プランのお支払いに失敗しました",
  "BillingNoticeMail.paymentWhat": "「{group}」の{plan}プランのお支払いに失敗しました。",
  "BillingNoticeMail.paymentKept":
    "お支払いを再試行している間、<strong>{date}</strong>まではプランをそのままご利用いただけます。その後も続けるには、グループのページでカード情報を更新してください。",
  "BillingNoticeMail.paymentFree":
    "グループは無料プランに切り替わりました。プランを元に戻すには、グループのページでカード情報を更新してください。",
  "BillingNoticeMail.planSubject": "{plan}プランは{date}に終了します",
  "BillingNoticeMail.planWhat":
    "「{group}」の{plan}プランは解約され、<strong>{date}</strong>に終了します。その後、グループは無料プランに切り替わります。",
  "BillingNoticeMail.planNext": "気が変わりましたか？それまでにグループのページで更新できます。",
  "SubscriberConfirmMail.subject": "{host}の購読を確認してください",
  "SubscriberConfirmMail.asked":
    "このメールアドレスで、{host}からのお知らせの購読が申し込まれました。",
  "SubscriberConfirmMail.within": "3日以内に確認すると、配信が始まります。",
  "SubscriberConfirmMail.button": "購読を確認",
  "SubscriberConfirmMail.ignore":
    "お心当たりがない場合は、このメールを無視してください。今後メールが届くことはありません。",
  "SubscriberWelcomeMail.subject": "{host}の購読が完了しました",
  "SubscriberWelcomeMail.subscribed": "{host}からのお知らせの購読が完了しました。",
  "SubscriberWelcomeMail.reason": "このメールは、{host}で購読を申し込まれた方にお送りしています。",
  "SubscriberWelcomeMail.unsubscribe": "購読解除",
  "SubscriberIssue.reason": "このメールは、{host}で購読を申し込まれた方にお送りしています。",
  "SubscriberIssue.readPost": "記事を読む",
} satisfies Catalog
