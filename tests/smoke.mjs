/* فحص دخان — ذِمّتي v1.2.2
   الاستخدام: node tests/smoke.mjs
   مع خادم: TEST_URL=http://127.0.0.1:8080 node tests/smoke.mjs */
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (cond, msg) => {
  console.log((cond ? '✔' : '✘') + ' ' + msg);
  cond ? pass++ : fail++;
};

// 1) الملفات
const files = ['index.html', 'jadwa.html', 'admin.html', 'site-config.json', 'css/style.css', 'js/app.js',
  'manifest.json', 'sw.js', 'assets/icon.svg', 'assets/icon-512.png',
  'docs/feasibility-study.md', 'docs/v1.2-changes-study.md', 'README.md'];
for (const f of files) ok(existsSync(root + f), `يوجد الملف: ${f}`);

// 2) manifest
try {
  const m = JSON.parse(readFileSync(root + 'manifest.json', 'utf8'));
  ok(m.dir === 'rtl' && m.lang === 'ar', 'manifest عربي RTL');
  ok(m.icons.every((i) => existsSync(root + i.src)), 'manifest: الأيقونات صحيحة');
} catch { ok(false, 'manifest JSON صالح'); }

// 3) site-config صالح (بنية v1.2.2)
let cfgOk = false;
try {
  const c = JSON.parse(readFileSync(root + 'site-config.json', 'utf8'));
  ok(c && typeof c.announce === 'object', 'site-config: بنية الإعلان سليمة');
  ok(typeof c.adminHash === 'string' && c.adminHash.length === 64, 'site-config: بصمة رمز الإدارة (64 hex)');
  ok(typeof c.adminVault === 'string' && c.adminVault.startsWith('v1.'), 'site-config: خزنة التوكن المشفّرة');
  ok(typeof c.googleClientId === 'string', 'site-config: خانة googleClientId');
  cfgOk = true;
} catch { ok(false, 'site-config JSON'); }

// 4) index — عام
const html = readFileSync(root + 'index.html', 'utf8');
ok(html.includes('dir="rtl"'), 'index: اتجاه RTL');
ok(/v1\.2\.[12]/.test(html), 'index: إصدار v1.2.x');

// خصوصية: لا روابط للجدوى من الواجهة العامة
ok(!html.includes('jadwa.html'), 'خصوصية: بدون رابط جدوى بالواجهة العامة');
ok(!html.toLowerCase().includes('فحص الجدوى'), 'خصوصية: بدون نص «فحص الجدوى» بالواجهة');

// التذييل / الحقوق
ok(html.includes('© 2026') || html.includes('&#169; 2026'), 'index: حقوق النشر 2026');
ok(html.includes('صقر رائد البدرساوي'), 'index: توقيع «تصميم وبرمجة: صقر رائد البدرساوي»');
ok(html.includes('site-footer'), 'index: تذييل عام');

// الدخول الظاهر + جوجل
const ids = [
  'view-home', 'view-people', 'view-settings', 'sheetPerson', 'sheetDetail', 'sheetPay', 'sheetShare',
  'modalConfirm', 'statNet', 'btnAdd', 'currencySel',
  'sheetInvite', 'btnShareSummary', 'installBanner', 'shLink', 'shNative', 'myName',
  'sheetLogin', 'loginToken', 'btnLogin', 'accountBox', 'btnOpenLogin', 'btnLogout', 'syncInfo',
  'catChips', 'catFilter', 'catManage', 'newCatName', 'btnAddCat',
  'overdueStrip', 'sheetDue', 'dueDate', 'pDue', 'payNote', 'btnNotify',
  'btnAccount', 'loginView', 'acctView', 'acctName', 'acctSync', 'btnLogoutAcct', 'btnSyncNow',
  'loginBanner', 'announceBar', 'announceText', 'announceClose',
  // v1.2.2 — جوجل
  'googleLogin', 'btnGoogle'
];
for (const id of ids) ok(html.includes(`id="${id}"`), `index: id=#${id}`);
ok(html.includes('data-filter="overdue"'), 'index: فلتر المتأخرات');

// 5) admin.html — بوّابة رمز + خصوصية
const admin = readFileSync(root + 'admin.html', 'utf8');
ok(admin.includes('noindex'), 'admin: مانع فهرسة noindex');
ok(admin.includes('لوحة إدارة'), 'admin: عنوان اللوحة');
for (const id of ['gate', 'pinInput', 'pinForm', 'btnPinGo', 'panel', 'anav', 'annText', 'annOn',
  'btnSaveCfg', 'btnRunChecks', 'btnPushCloud', 'btnPullCloud', 'backupsList', 'btnAdminLogout',
  'oldPin', 'newPin', 'newPin2', 'btnChangePin', 'patInput', 'btnSavePat', 'patStatus',
  'attList', 'attBadge', 'btnClearAttempts', 'gidInput', 'btnSaveGid', 'btnGoogle']) {
  if (id === 'btnGoogle') continue; // اللوحة ليست مكان زر جوجل
  ok(admin.includes(`id="${id}"`), `admin: id=#${id}`);
}
ok(admin.includes('صقر رائد البدرساوي'), 'admin: التوقيع');
ok(admin.includes('© 2026'), 'admin: حقوق النشر');
ok(admin.includes('site-config.json'), 'admin: إدارة المحتوى العام');
ok(/id="panel" hidden/.test(admin), 'admin: اللوحة مخفية افتراضيًا');
// البوابة = بصمة رمز (بلا توكن نصّي)
ok(!admin.includes('adminTok'), 'admin: بلا حقل توكن بوّابة قديم');
ok(admin.includes('adminHash') && admin.includes('PBKDF2'), 'admin: بوّابة رمز مشفّرة (SHA-256+PBKDF2)');
ok(/ghp_[A-Za-z0-9]{20,}/.test(admin) === false, 'admin: بلا توكن مكشوف بالملف');

// 6) jadwa — داخلي
const jadwa = readFileSync(root + 'jadwa.html', 'utf8');
ok(jadwa.includes('noindex'), 'jadwa: مانع فهرسة noindex');
ok(jadwa.includes('صقر رائد البدرساوي'), 'jadwa: التوقيع');
ok(jadwa.includes('© 2026'), 'jadwa: حقوق النشر');
ok(jadwa.includes('95.9'), 'jadwa: المحتوى محفوظ');

// 7) صياغة JS
try {
  execSync(`node --check "${root}js/app.js"`, { stdio: 'pipe' });
  ok(true, 'js/app.js سليم نحوًا');
} catch (e) { ok(false, 'js/app.js: ' + e.message); }
try {
  execSync(`node --check "${root}sw.js"`, { stdio: 'pipe' });
  ok(true, 'sw.js سليم نحوًا');
} catch (e) { ok(false, 'sw.js سليم نحوًا'); }
// JS اللوحة (مستخرج من HTML)
try {
  const m = admin.match(/<script>([\s\S]*?)<\/script>/);
  if (m) {
    writeFileSync('/tmp/admin-extract.js', m[1]);
    execSync('node --check "/tmp/admin-extract.js"', { stdio: 'pipe' });
    ok(true, 'admin: JS سليم نحوًا');
  } else ok(false, 'admin: ما في script');
} catch (e) { ok(false, 'admin: JS — ' + e.message); }

// 8) SW + المنطق
const sw = readFileSync(root + 'sw.js', 'utf8');
ok(/dhimmati-v1\.2\.[12]/.test(sw), 'sw: كاش v1.2.x');

const app = readFileSync(root + 'js/app.js', 'utf8');
const checks = [
  ['localStorage', 'حفظ محلي'], ['wa.me', 'واتساب'], ['inviteURL', 'رابط طلب'],
  ['doLogin', 'تسجيل الدخول'], ['/gists', 'مزامنة Gist'], ['scheduleSync', 'مزامنة مؤجّلة'],
  ['doLogout', 'خروج آمن'], ['Notification', 'تنبيهات'], ['dueInfo', 'مواعيد'],
  ['formCat', 'تصنيفات'], ['undoBuf', 'تراجع حذف'], ['payNote', 'ملاحظة دفعة'],
  ['openAccount', 'ورقة الحساب'], ['announceBar', 'الإعلان العام'], ['site-config.json', 'قراءة الإعداد'],
  // v1.2.2 — جوجل
  ['doGoogleLogin', 'دخول جوجل'], ['googleSave', 'حفظ بالدرايف'], ['googleLoad', 'سحب من الدرايف'],
  ['ensureGToken', 'رمز وصول جوجل'], ['gCfgId', 'إعداد googleClientId'], ['drive.file', 'نطاق الدرايف']
];
for (const [n, label] of checks) ok(app.includes(n), `app: ${label}`);
ok(!/ghp_[A-Za-z0-9]{20,}/.test(app), 'app: بلا توكنات مثبّتة');
// رسالة خطأ gist واضحة (مشكلة التوكن بلا نطاق)
ok(app.includes("بلا نطاق gist"), 'app: رسالة نقص نطاق gist');

// 9) أمن: لا توكنات بأي ملف
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (f === '.git') continue;
    const p = join(dir, f);
    try {
      const st = readFileSync(p);
      if (st.length < 500000 && !f.endsWith('.png')) out.push(p);
    } catch (e) { /* */ }
  }
  return out;
}
let leaked = [];
for (const p of walk(root)) {
  if (/ghp_[A-Za-z0-9]{20,}/.test(readFileSync(p, 'utf8'))) leaked.push(p.replace(root, ''));
}
ok(leaked.length === 0, 'أمن: بلا توكنات مكشوفة بالمستودع' + (leaked.length ? ' — ' + leaked.join(',') : ''));

// 10) HTTP
const base = process.env.TEST_URL;
if (base) {
  const paths = ['/', '/index.html', '/admin.html', '/site-config.json', '/jadwa.html',
    '/css/style.css', '/js/app.js', '/manifest.json', '/sw.js'];
  for (const p of paths) {
    try {
      const r = await fetch(base.replace(/\/$/, '') + p);
      ok(r.status === 200, `HTTP 200: ${p}`);
    } catch (e) { ok(false, `HTTP: ${p}`); }
  }
  const r = await fetch(base.replace(/\/$/, '') + '/');
  const t = await r.text();
  ok(t.includes('صقر رائد البدرساوي') && t.includes('btnAccount'), 'HTTP: التوقيع + الدخول يصلان');
  const ra = await fetch(base.replace(/\/$/, '') + '/admin.html');
  const ta = await ra.text();
  ok(ta.includes('noindex') && ta.includes('pinInput'), 'HTTP: بوّابة الرمز محمية+Fهرسة');
  const rc = await fetch(base.replace(/\/$/, '') + '/site-config.json');
  const jc = await rc.json().catch(() => null);
  ok(jc && jc.adminHash && jc.adminVault, 'HTTP: إعداد اللوحة يصل');
} else {
  console.log('ℹ️  (اختياري) TEST_URL=... لفحص HTTP');
}

console.log(`\nالنتيجة: ${pass} ناجح / ${fail} فاشل`);
process.exit(fail ? 1 : 0);
