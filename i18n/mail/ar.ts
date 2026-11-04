import type { Catalog } from "@spy4x/platform/universal/i18n"

export default {
  "Mail.sentBy": "— رسالة من",
  "Mail.signIn": "تسجيل الدخول",
  "Mail.openProfile": "افتح ملفك الشخصي",
  "Mail.openGroup": "افتح المجموعة",
  "Mail.dontShare": "لا تشارك هذا الرمز مع أحد. لن يطلبه منك {host} أبدًا.",
  "PasswordResetMail.subject": "رمزك لإعادة تعيين كلمة المرور",
  "PasswordResetMail.asked":
    "وصلنا طلب لإعادة تعيين كلمة مرور حسابك على {host}. أدخل هذا الرمز في علامة التبويب التي طلبته منها:",
  "PasswordResetMail.valid": {
    "zero": "الرمز صالح لمرة واحدة، واستخدامه يسجّل خروجك من جميع أجهزتك.",
    "one": "الرمز صالح لمرة واحدة ولمدة دقيقة واحدة، واستخدامه يسجّل خروجك من جميع أجهزتك.",
    "two": "الرمز صالح لمرة واحدة ولمدة دقيقتين، واستخدامه يسجّل خروجك من جميع أجهزتك.",
    "few": "الرمز صالح لمرة واحدة ولمدة {count} دقائق، واستخدامه يسجّل خروجك من جميع أجهزتك.",
    "many": "الرمز صالح لمرة واحدة ولمدة {count} دقيقة، واستخدامه يسجّل خروجك من جميع أجهزتك.",
    "other": "الرمز صالح لمرة واحدة ولمدة {count} دقيقة، واستخدامه يسجّل خروجك من جميع أجهزتك.",
  },
  "PasswordResetMail.ignore": "إذا لم تطلب ذلك، فتجاهل هذه الرسالة، ولن تتغير كلمة مرورك.",
  "PasswordResetNoticeMail.subject": "إعادة تعيين كلمة المرور",
  "PasswordResetNoticeMail.asked":
    "أرسل إليك فريق {host} هذه الرسالة لتتمكن من اختيار كلمة مرور جديدة لحسابك.",
  "PasswordResetNoticeMail.how":
    "افتح الصفحة أدناه وأدخل هذا البريد الإلكتروني. سنرسل إليك رمزًا هناك، ثم تختار كلمة المرور الجديدة.",
  "PasswordResetNoticeMail.button": "إعادة تعيين كلمة المرور",
  "PasswordResetNoticeMail.ignore":
    "إذا لم تكن تريد كلمة مرور جديدة، فتجاهل هذه الرسالة، ولن تتغير كلمة مرورك.",
  "SignInCodeMail.subject": "رمز تسجيل الدخول إلى {host}",
  "SignInCodeMail.asked":
    "وصلنا طلب لتسجيل الدخول إلى {host} بهذا البريد الإلكتروني في {when}. أدخل هذا الرمز في علامة التبويب التي طلبته منها:",
  "SignInCodeMail.valid": {
    "zero": "الرمز صالح لمرة واحدة. وإن لم يكن هناك حساب بهذا البريد بعد، فسيُنشئ لك حسابًا.",
    "one":
      "الرمز صالح لمرة واحدة ولمدة دقيقة واحدة. وإن لم يكن هناك حساب بهذا البريد بعد، فسيُنشئ لك حسابًا.",
    "two":
      "الرمز صالح لمرة واحدة ولمدة دقيقتين. وإن لم يكن هناك حساب بهذا البريد بعد، فسيُنشئ لك حسابًا.",
    "few":
      "الرمز صالح لمرة واحدة ولمدة {count} دقائق. وإن لم يكن هناك حساب بهذا البريد بعد، فسيُنشئ لك حسابًا.",
    "many":
      "الرمز صالح لمرة واحدة ولمدة {count} دقيقة. وإن لم يكن هناك حساب بهذا البريد بعد، فسيُنشئ لك حسابًا.",
    "other":
      "الرمز صالح لمرة واحدة ولمدة {count} دقيقة. وإن لم يكن هناك حساب بهذا البريد بعد، فسيُنشئ لك حسابًا.",
  },
  "SignInCodeMail.ignore":
    "إذا لم تطلب ذلك، فتجاهل هذه الرسالة. لا يمكن لأحد تسجيل الدخول من دون هذا الرمز.",
  "EmailCodeMail.subject": "رمز تأكيد بريدك الإلكتروني",
  "EmailCodeMail.asked": "أدخل هذا الرمز على {host} لتأكيد بريدك الإلكتروني.",
  "EmailCodeMail.valid": {
    "zero": "يعمل الرمز مرة واحدة فقط.",
    "one": "يعمل الرمز مرة واحدة فقط، وخلال دقيقة واحدة.",
    "two": "يعمل الرمز مرة واحدة فقط، وخلال دقيقتين.",
    "few": "يعمل الرمز مرة واحدة فقط، وخلال {count} دقائق.",
    "many": "يعمل الرمز مرة واحدة فقط، وخلال {count} دقيقة.",
    "other": "يعمل الرمز مرة واحدة فقط، وخلال {count} دقيقة.",
  },
  "EmailCodeMail.ignore": "إذا لم تطلب ذلك، فتجاهل هذه الرسالة، ولن يتغير شيء.",
  "InvitationMail.subject": "دعوة للانضمام إلى «{group}»",
  "InvitationMail.invited":
    "دعاك <strong>{who}</strong> للانضمام إلى «{group}» على {host} بدور {role}.",
  "InvitationMail.invitedNoName": "لديك دعوة للانضمام إلى «{group}» على {host} بدور {role}.",
  "InvitationMail.open": {
    "zero": "افتح الدعوة الآن لتقبلها أو ترفضها.",
    "one": "افتح الدعوة خلال يوم واحد لتقبلها أو ترفضها.",
    "two": "افتح الدعوة خلال يومين لتقبلها أو ترفضها.",
    "few": "افتح الدعوة خلال {count} أيام لتقبلها أو ترفضها.",
    "many": "افتح الدعوة خلال {count} يومًا لتقبلها أو ترفضها.",
    "other": "افتح الدعوة خلال {count} يوم لتقبلها أو ترفضها.",
  },
  "InvitationMail.button": "افتح الدعوة",
  "InvitationMail.account":
    "الدعوة مرسلة إلى هذا البريد الإلكتروني، لذا اقبلها من الحساب الذي يستخدمه.",
  "InvitationMail.ignore": "إذا كنت لا ترغب في الانضمام، فتجاهل هذه الرسالة ببساطة.",
  "AccountDeletionMail.subject": "سيُحذف حسابك في {date}",
  "AccountDeletionMail.asked":
    "بناءً على طلبك، سيُحذف حسابك على {host} نهائيًا في <strong>{date}</strong>.",
  "AccountDeletionMail.keep": "غيّرت رأيك؟ سجّل الدخول قبل هذا التاريخ لتحتفظ بحسابك.",
  "AccountDeletionMail.notYou":
    "إذا لم تطلب ذلك، فسجّل الدخول الآن لتحتفظ بحسابك، ثم غيّر كلمة المرور.",
  "AccountRestoredMail.subject": "لن يُحذف حسابك",
  "AccountRestoredMail.restored": "سجّل أحدهم الدخول إلى حسابك على {host}، لذا لن يُحذف الحساب.",
  "AccountRestoredMail.notYou":
    "إذا لم تكن أنت، فسجّل الدخول وغيّر كلمة المرور، ثم احذف حسابك من جديد.",
  "DataExportReadyMail.subject": "نسخة بياناتك جاهزة",
  "DataExportReadyMail.ready": "نزّلها من ملفك الشخصي قبل <strong>{date}</strong>.",
  "DataExportReadyMail.notYou": "إذا لم تطلب ذلك، فغيّر كلمة المرور وسجّل الخروج من أجهزتك الأخرى.",
  "SignInMethodMail.passkeyAddedSubject": "أُضيف مفتاح مرور إلى حسابك",
  "SignInMethodMail.passkeyAdded":
    "أُضيف مفتاح مرور إلى حسابك على {host} في {when}، ويمكن الآن تسجيل الدخول به.",
  "SignInMethodMail.passkeyAddedNotYou":
    "إذا لم تكن أنت، فأزل مفتاح المرور من ملفك الشخصي وغيّر كلمة المرور.",
  "SignInMethodMail.passkeyRemovedSubject": "أُزيل مفتاح مرور من حسابك",
  "SignInMethodMail.passkeyRemoved":
    "أُزيل مفتاح مرور من حسابك على {host} في {when}، ولم يعد ممكنًا تسجيل الدخول به.",
  "SignInMethodMail.passkeyRemovedNotYou":
    "إذا لم تكن أنت، فسجّل الدخول وغيّر كلمة المرور، ثم أضف مفتاح المرور من جديد.",
  "SignInMethodMail.linkedSubject": "رُبط {provider} بحسابك",
  "SignInMethodMail.linked":
    "رُبط {provider} بحسابك على {host} في {when}، ويمكنك الآن تسجيل الدخول به.",
  "SignInMethodMail.linkedNotYou":
    "إذا لم تكن أنت، فألغِ ربط {provider} من ملفك الشخصي وغيّر كلمة المرور.",
  "SignInMethodMail.unlinkedSubject": "أُلغي ربط {provider} بحسابك",
  "SignInMethodMail.unlinked":
    "أُلغي ربط {provider} بحسابك على {host} في {when}، ولم يعد بإمكانك تسجيل الدخول به.",
  "SignInMethodMail.unlinkedNotYou":
    "إذا لم تكن أنت، فسجّل الدخول وغيّر كلمة المرور، ثم اربط {provider} من جديد.",
  "ApiTokenMail.subject": "أُنشئ رمز API مميز جديد",
  "ApiTokenMail.created": "أُنشئ رمز API مميز باسم «{name}» لحسابك على {host}.",
  "ApiTokenMail.readUntil": "يمكنه قراءة المجموعة «{group}»، وتنتهي صلاحيته في {date}.",
  "ApiTokenMail.readForever": "يمكنه قراءة المجموعة «{group}»، ولا تنتهي صلاحيته.",
  "ApiTokenMail.writeUntil": "يمكنه قراءة المجموعة «{group}» وتعديلها، وتنتهي صلاحيته في {date}.",
  "ApiTokenMail.writeForever": "يمكنه قراءة المجموعة «{group}» وتعديلها، ولا تنتهي صلاحيته.",
  "ApiTokenMail.notYou":
    "إذا لم تكن أنت، فألغِ الرمز من ملفك الشخصي وغيّر كلمة المرور. تغيير كلمة المرور يُلغي كل رموز API المميزة.",
  "BillingNoticeMail.paidPlan": "مدفوعة",
  "BillingNoticeMail.trialSubject": "تنتهي الفترة التجريبية لخطة {plan} في {date}",
  "BillingNoticeMail.trialWhat":
    "تنتهي الفترة التجريبية لخطة {plan} في المجموعة «{group}» في <strong>{date}</strong>.",
  "BillingNoticeMail.trialWithCard":
    "بعدها يبدأ الاشتراك وتُخصم الرسوم من بطاقتك. لإيقافه، ألغِه من صفحة المجموعة قبل ذلك التاريخ.",
  "BillingNoticeMail.trialWithoutCard":
    "للاحتفاظ بالخطة، أضف بطاقة من صفحة المجموعة قبل ذلك التاريخ، فيبدأ الاشتراك وتُخصم الرسوم من بطاقتك. ومن دون بطاقة، تنتقل المجموعة إلى الخطة المجانية.",
  "BillingNoticeMail.paymentSubject": "تعذّر الدفع لخطة {plan}",
  "BillingNoticeMail.paymentWhat": "تعذّر الدفع لخطة {plan} في المجموعة «{group}».",
  "BillingNoticeMail.paymentKept":
    "تبقى الخطة متاحة لك حتى <strong>{date}</strong> بينما نعيد محاولة الدفع. وللاحتفاظ بها بعد ذلك، حدّث البطاقة من صفحة المجموعة.",
  "BillingNoticeMail.paymentFree":
    "انتقلت المجموعة إلى الخطة المجانية. لاستعادة خطتك، حدّث البطاقة من صفحة المجموعة.",
  "BillingNoticeMail.planSubject": "تنتهي خطة {plan} في {date}",
  "BillingNoticeMail.planWhat":
    "أُلغيت خطة {plan} في المجموعة «{group}»، وتنتهي في <strong>{date}</strong>، ثم تنتقل المجموعة إلى الخطة المجانية.",
  "BillingNoticeMail.planNext": "غيّرت رأيك؟ جدّد الخطة من صفحة المجموعة قبل ذلك التاريخ.",
  "SubscriberConfirmMail.subject": "أكّد اشتراكك في أخبار {host}",
  "SubscriberConfirmMail.asked": "سُجّل هذا البريد الإلكتروني لتلقّي أخبار {host}.",
  "SubscriberConfirmMail.within": "أكّد الاشتراك خلال ثلاثة أيام لتبدأ في تلقّيها.",
  "SubscriberConfirmMail.button": "تأكيد الاشتراك",
  "SubscriberConfirmMail.ignore": "إذا لم تطلب ذلك، فتجاهل هذه الرسالة، ولن نرسل إليك شيئًا.",
  "SubscriberWelcomeMail.subject": "اشتركت في أخبار {host}",
  "SubscriberWelcomeMail.subscribed": "أنت الآن مشترك في أخبار {host}.",
  "SubscriberWelcomeMail.reason": "وصلتك هذه الرسالة لأنك اشتركت في أخبار {host}.",
  "SubscriberWelcomeMail.unsubscribe": "إلغاء الاشتراك",
  "SubscriberIssue.reason": "وصلتك هذه الرسالة لأنك اشتركت في أخبار {host}.",
  "SubscriberIssue.readPost": "اقرأ المقال",
} satisfies Catalog
