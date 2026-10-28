/* فحص دخان — ذِمّتي v1.2
   الاستخدام: node tests/smoke.mjs
   مع خادم: TEST_URL=http://127.0.0.1:8080 node tests/smoke.mjs */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (cond, msg) => {
  console.log((cond ? '✔' : '✘') + ' ' + msg);
  cond ? pass++ : fail++;
};

// 1) الملفات
const files = ['index.html', 'jadwa.html', 'css/style.css', 'js/app.js', 'manifest.json', 'sw.js',
  'assets/icon.svg', 'assets/icon-512.png', 'docs/feasibility-study.md', 'docs/v1.2-changes-study.md', 'README.md'];
for (const f of files) ok(existsSync(root + f), `يوجد الملف: ${f}`);

// 2) manifest
try {
  const m = JSON.parse(readFileSync(root + 'manifest.json', 'utf8'));
  ok(m.dir === 'rtl' && m.lang === 'ar', 'manifest عربي RTL');
  ok(m.icons.every((i) => existsSync(root + i.src)), 'manifest: مسارات الأيقونات صحيحة');
} catch { ok(false, 'manifest JSON صالح'); }

// 3) الهيكل — أساسي + v1.1 + v1.2
const html = readFileSync(root + 'index.html', 'utf8');
ok(html.includes('dir="rtl"'), 'index: اتجاه RTL');
const ids = [
  'view-home', 'view-people', 'view-settings', 'sheetPerson', 'sheetDetail',
  'sheetPay', 'sheetShare', 'modalConfirm', 'statNet', 'btnAdd', 'currencySel',
  // v1.1
  'sheetInvite', 'inviteMsg', 'btnInviteAccept', 'btnShareSummary', 'installBanner',
  'shLink', 'shNative', 'myName',
  // v1.2 — الحساب
  'sheetLogin', 'loginToken', 'btnLogin', 'accountBox', 'accountLoggedOut', 'accountLoggedIn',
  'btnOpenLogin', 'btnLogout', 'syncInfo',
  // v1.2 — التصنيفات
  'catChips', 'quickCatRow', 'quickCatName', 'catFilter', 'catManage', 'newCatName', 'btnAddCat',
  // v1.2 — المواعيد والتنبيهات
  'overdueStrip', 'overdueCount', 'sheetDue', 'dueDate', 'dueClear', 'pDue', 'payNote', 'btnNotify'
];
for (const id of ids) ok(html.includes(`id="${id}"`), `index: id=#${id}`);
ok(html.includes('v1.2.0'), 'index: الإصدار v1.2.0');
ok(html.includes('data-filter="overdue"'), 'index: فلتر المتأخرات');

// 4) صياغة JS
try {
  execSync(`node --check "${root}js/app.js"`, { stdio: 'pipe' });
  ok(true, 'js/app.js سليم نحوًا');
} catch (e) { ok(false, 'js/app.js: ' + e.message); }
try {
  execSync(`node --check "${root}sw.js"`, { stdio: 'pipe' });
  ok(true, 'sw.js سليم نحوًا');
} catch (e) { ok(false, 'sw.js سليم نحوًا'); }

// 5) SW
const sw = readFileSync(root + 'sw.js', 'utf8');
ok(sw.includes('dhimmati-v1.2'), 'sw: كاش v1.2');

// 6) المنطق
const app = readFileSync(root + 'js/app.js', 'utf8');
const checks = [
  ['localStorage', 'حفظ محلي'],
  ['wa.me', 'مشاركة واتساب'],
  ['serviceWorker', 'تسجيل PWA'],
  ['inviteURL', 'رابط طلب موجّه'],
  ['shareTextSummary', 'ملخص مشترك'],
  ['navigator.share', 'مشاركة نظام'],
  ['beforeinstallprompt', 'تثبيت PWA'],
  // v1.2
  ['doLogin', 'تسجيل الدخول'],
  ['/gists', 'تخزين Gist سحابي'],
  ['scheduleSync', 'مزامنة تلقائية مؤجّلة'],
  ['doLogout', 'تسجيل خروج آمن'],
  ['Notification', 'تنبيهات المتصفح'],
  ['fireDueNotifications', 'فحص ديون متأخرة'],
  ['dueInfo', 'مواعيد الاستحقاق'],
  ['isOverdue', 'منطق التأخر'],
  ['formCat', 'التصنيفات'],
  ['undoBuf', 'تراجع عن الحذف'],
  ['payNote', 'ملاحظة الدفعة'],
  ['renderCatManage', 'إدارة التصنيفات']
];
for (const [n, label] of checks) ok(app.includes(n), `app: ${label}`);
ok(!/api[_-]?key|Bearer ghp_/i.test(app), 'app: بلا توكنات مثبّتة');

// 7) أمن: لا توكنات بأي ملف نصي بالمستودع
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (f === '.git') continue;
    const p = join(dir, f);
    try {
      const st = readFileSync(p);
      if (st.length < 400000 && !f.endsWith('.png')) out.push(p);
    } catch (e) { /* */ }
  }
  return out;
}
let leaked = [];
for (const p of walk(root)) {
  const c = readFileSync(p, 'utf8');
  if (/ghp_[A-Za-z0-9]{20,}/.test(c)) leaked.push(p.replace(root, ''));
}
ok(leaked.length === 0, 'أمن: بلا توكنات مسجّلة بالمستودع' + (leaked.length ? ' — ' + leaked.join(',') : ''));

// 8) الجدوى
const jadwa = readFileSync(root + 'jadwa.html', 'utf8');
ok(jadwa.includes('95.9'), 'jadwa: المؤشر 95.9%');

// 9) HTTP
const base = process.env.TEST_URL;
if (base) {
  for (const p of ['/', '/index.html', '/css/style.css', '/js/app.js', '/manifest.json', '/sw.js', '/jadwa.html']) {
    try {
      const r = await fetch(base.replace(/\/$/, '') + p);
      ok(r.status === 200, `HTTP 200: ${p}`);
    } catch (e) { ok(false, `HTTP: ${p}`); }
  }
  const r = await fetch(base.replace(/\/$/, '') + '/');
  const t = await r.text();
  ok(t.includes('ذِمّتي') && t.includes('sheetLogin'), 'HTTP: محتوى v1.2 يصل');
} else {
  console.log('ℹ️  (اختياري) TEST_URL=... لفحص HTTP');
}

console.log(`\nالنتيجة: ${pass} ناجح / ${fail} فاشل`);
process.exit(fail ? 1 : 0);
