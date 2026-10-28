# ذِمّتي 📒 — دفتر الديون الذكي

**تطبيق ويب عربي (PWA)** لتسجيل الديون الشخصية: من مين وبكم — ليّا عليه أو أنا عليه — مع مشاركة بلمسة عبر واتساب وبطاقات صورة، **بدون تسجيل** و**بدون سيرفر**، وكل بياناتك تبقى داخل متصفحك.

> ### 🔗 الروابط
> - **الرابط الدائم (GitHub Pages):** https://aldayt38-commits.github.io/sanad-invoices/
> - **فحوى الجدوى:** https://aldayt38-commits.github.io/sanad-invoices/jadwa.html
> - **المستودع:** https://github.com/aldayt38-commits/sanad-invoices

## 🛠️ التشغيل محليًا

```bash
python3 -m http.server 8080 --directory .
# افتح http://localhost:8080
```

أو:

```bash
npx serve .
```

لا يوجد Build ولا اعتماديات — كل شيء HTML/CSS/JS خام.

## 🧪 الاختبارات

```bash
node tests/smoke.mjs                          # فحص البنية والصياغة
TEST_URL=http://127.0.0.1:8080 node tests/smoke.mjs   # + فحص HTTP
```

## 🚀 النشر والدومين

**نشر مجاني فوري (أي طريقة):**

1. **GitHub Pages:** ارفع المستودع إلى GitHub → Settings → Pages → Branch: `main` → ستحصل على `https://<اسمك>.github.io/dhimmati`
2. **Cloudflare Pages / Netlify Drop:** اسحب مجلد المشروع → رابط فوري بـ HTTPS.
3. **دومين مخصّص (~$10/سنة):** اشترِ من Cloudflare Registrar / Namecheap → CNAME إلى استضافتك → اضبط `start_url` و`scope` داخل `manifest.json` إن لزم.

> الملف `CNAME` اختياري: أنشئه باسم دومينك بدون `https://` (سطر واحد) وضِعه بجذر المستودع عند رفعه على GitHub Pages.

## 📂 بنية المستودع

```
dhimmati/
├── index.html              # التطبيق
├── jadwa.html              # صفحة فحص الجدوى العامة
├── manifest.json           # PWA manifest
├── sw.js                   # Service Worker (أوفلاين)
├── css/style.css           # نظام التصميم
├── js/app.js               # كل المنطق (بلا اعتماديات)
├── assets/icon.svg         # أيقونة متجهة
├── assets/icon-512.png     # أيقونة نقطية
├── docs/feasibility-study.md  # فحص الجدوى الكامل
├── tests/smoke.mjs         # اختبارات دخان
└── README.md               # هذا الملف
```

## 📄 الترخيص

MIT — استخدمه وطوّره وبِع عليه (انظر [LICENSE](LICENSE)).

---

**مؤشرات الجدوى:** انتشار (تصميم الآلية) **95.91%** ✅ · تنفيذ **100%** ✅ · تكلفة تشغيل **$0** ✅
