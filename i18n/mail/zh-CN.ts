import type { Catalog } from "@spy4x/platform/universal/i18n"

export default {
  "Mail.sentBy": "— 发自",
  "Mail.signIn": "登录",
  "Mail.openProfile": "打开个人资料",
  "Mail.openGroup": "打开群组",
  "PasswordResetMail.subject": "重置你的密码",
  "PasswordResetMail.asked": "有人请求重置你在 {host} 的账号密码。",
  "PasswordResetMail.open": {
    "other": "请在 {count} 分钟内打开此链接，设置新密码。",
  },
  "PasswordResetMail.button": "设置新密码",
  "PasswordResetMail.once": "此链接只能使用一次。使用后，你会在所有设备上退出登录。",
  "PasswordResetMail.ignore": "如果这不是你本人的操作，请忽略这封邮件，你的密码不会改变。",
  "SignInLinkMail.subject": "你的 {host} 登录链接",
  "SignInLinkMail.asked": "有人于{when}请求用这个邮箱登录 {host}。",
  "SignInLinkMail.open": {
    "other": "请在 {count} 分钟内打开此链接完成登录。如果这个邮箱还没有账号，会自动为你创建一个。",
  },
  "SignInLinkMail.button": "登录 {host}",
  "SignInLinkMail.once":
    "此链接只能使用一次。它会打开一个带有“继续”按钮的页面，在你点击之前不会进行任何操作。",
  "SignInLinkMail.ignore":
    "如果这不是你本人的操作，请忽略这封邮件。没有这个链接，任何人都无法登录。",
  "EmailCodeMail.subject": "你的邮箱验证码",
  "EmailCodeMail.asked": "请在 {host} 输入此验证码，以验证你的邮箱。",
  "EmailCodeMail.valid": {
    "other": "验证码只能使用一次，{count} 分钟内有效。",
  },
  "EmailCodeMail.ignore": "如果这不是你本人的操作，请忽略这封邮件，什么都不会改变。",
  "InvitationMail.subject": "你受邀加入“{group}”",
  "InvitationMail.invited": "<strong>{who}</strong>邀请你以{role}身份加入 {host} 上的“{group}”。",
  "InvitationMail.invitedNoName": "你受邀以{role}身份加入 {host} 上的“{group}”。",
  "InvitationMail.open": {
    "other": "请在 {count} 天内打开邀请，选择接受或拒绝。",
  },
  "InvitationMail.button": "打开邀请",
  "InvitationMail.account": "这份邀请是发给这个邮箱的，请用绑定这个邮箱的账号接受邀请。",
  "InvitationMail.ignore": "如果你不想加入，忽略这封邮件即可。",
  "AccountDeletionMail.subject": "你的账号将于{date}删除",
  "AccountDeletionMail.asked":
    "按照你的请求，你在 {host} 的账号将于<strong>{date}</strong>永久删除。",
  "AccountDeletionMail.keep": "改变主意了？在此之前登录即可保留你的账号。",
  "AccountDeletionMail.notYou": "如果这不是你本人的操作，请立即登录以保留账号，然后修改密码。",
  "AccountRestoredMail.subject": "你的账号不会被删除了",
  "AccountRestoredMail.restored": "有人登录了你在 {host} 的账号，因此账号不会被删除。",
  "AccountRestoredMail.notYou": "如果这不是你本人，请登录、修改密码，然后重新删除账号。",
  "DataExportReadyMail.subject": "你的数据已准备好",
  "DataExportReadyMail.ready": "<strong>{date}</strong>之前，你可以在个人资料中下载。",
  "DataExportReadyMail.notYou": "如果这不是你本人的操作，请修改密码，并在其他设备上退出登录。",
  "SignInMethodMail.passkeyAddedSubject": "你的账号添加了一个通行密钥",
  "SignInMethodMail.passkeyAdded":
    "{when}，你在 {host} 的账号添加了一个通行密钥，现在可以用它登录。",
  "SignInMethodMail.passkeyAddedNotYou":
    "如果这不是你本人，请在个人资料中移除该通行密钥，并修改密码。",
  "SignInMethodMail.passkeyRemovedSubject": "你的账号移除了一个通行密钥",
  "SignInMethodMail.passkeyRemoved":
    "{when}，你在 {host} 的账号移除了一个通行密钥，之后无法再用它登录。",
  "SignInMethodMail.passkeyRemovedNotYou":
    "如果这不是你本人，请登录、修改密码，然后重新添加你的通行密钥。",
  "SignInMethodMail.linkedSubject": "你的账号已关联 {provider}",
  "SignInMethodMail.linked": "{when}，你在 {host} 的账号关联了 {provider}，现在可以用它登录。",
  "SignInMethodMail.linkedNotYou":
    "如果这不是你本人，请在个人资料中取消关联 {provider}，并修改密码。",
  "SignInMethodMail.unlinkedSubject": "你的账号已取消关联 {provider}",
  "SignInMethodMail.unlinked":
    "{when}，你在 {host} 的账号取消关联了 {provider}，之后无法再用它登录。",
  "SignInMethodMail.unlinkedNotYou":
    "如果这不是你本人，请登录、修改密码，然后重新关联 {provider}。",
  "ApiTokenMail.subject": "已创建新的 API 令牌",
  "ApiTokenMail.created": "你在 {host} 的账号创建了一个名为“{name}”的 API 令牌。",
  "ApiTokenMail.readUntil": "它可以读取群组“{group}”，将于{date}过期。",
  "ApiTokenMail.readForever": "它可以读取群组“{group}”，永不过期。",
  "ApiTokenMail.writeUntil": "它可以读取和修改群组“{group}”，将于{date}过期。",
  "ApiTokenMail.writeForever": "它可以读取和修改群组“{group}”，永不过期。",
  "ApiTokenMail.notYou":
    "如果这不是你本人，请在个人资料中撤销该令牌，并修改密码。修改密码会撤销所有 API 令牌。",
  "BillingNoticeMail.paidPlan": "付费",
  "BillingNoticeMail.trialSubject": "你的 {plan} 试用期将于{date}结束",
  "BillingNoticeMail.trialWhat": "“{group}”的 {plan} 试用期将于<strong>{date}</strong>结束。",
  "BillingNoticeMail.trialWithCard":
    "届时订阅将开始，并从你的银行卡扣款。如果不想继续，请在此之前到群组页面取消。",
  "BillingNoticeMail.trialWithoutCard":
    "如果想保留这个套餐，请在此之前到群组页面添加银行卡。届时订阅将开始，并从你的银行卡扣款。如果没有添加银行卡，群组会转为免费版。",
  "BillingNoticeMail.paymentSubject": "{plan} 的一笔付款失败了",
  "BillingNoticeMail.paymentWhat": "“{group}”的 {plan} 套餐有一笔付款失败了。",
  "BillingNoticeMail.paymentKept":
    "我们会重新尝试扣款，在<strong>{date}</strong>之前你仍可继续使用这个套餐。如果之后还想继续使用，请到群组页面更新银行卡。",
  "BillingNoticeMail.paymentFree": "群组现已转为免费版。如果想恢复套餐，请到群组页面更新银行卡。",
  "BillingNoticeMail.planSubject": "你的 {plan} 套餐将于{date}结束",
  "BillingNoticeMail.planWhat":
    "“{group}”的 {plan} 套餐已取消，将于<strong>{date}</strong>结束，之后群组会转为免费版。",
  "BillingNoticeMail.planNext": "改变主意了？在此之前到群组页面续订即可。",
  "SubscriberConfirmMail.subject": "确认订阅 {host}",
  "SubscriberConfirmMail.asked": "有人用这个邮箱订阅了 {host} 的动态。",
  "SubscriberConfirmMail.within": "请在三天内确认，之后就会开始收到邮件。",
  "SubscriberConfirmMail.button": "确认订阅",
  "SubscriberConfirmMail.ignore":
    "如果这不是你本人的操作，请忽略这封邮件，我们不会给你发送任何内容。",
  "SubscriberWelcomeMail.subject": "你已订阅 {host}",
  "SubscriberWelcomeMail.subscribed": "你已订阅 {host} 的动态。",
  "SubscriberWelcomeMail.reason": "你收到这封邮件，是因为你在 {host} 订阅了邮件简报。",
  "SubscriberWelcomeMail.unsubscribe": "退订",
  "SubscriberIssue.reason": "你收到这封邮件，是因为你在 {host} 订阅了邮件简报。",
  "SubscriberIssue.readPost": "阅读全文",
} satisfies Catalog
