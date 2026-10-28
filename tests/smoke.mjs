/* فحص دخان — ذِمّتي
   الاستخدام: node tests/smoke.mjs
   مع خادم شغّال: TEST_URL=http://127.0.0.1:8080 node tests/smoke.mjs */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (cond, msg) => {
  console.log((cond ? '✔' : '✘') + ' ' + msg);
  cond ? pass++ : fail++;
};

// 1) الملفات الأساسية
const files = ['index.html', 'jadwa.html', 'css/style.css', 'js/app.js', 'manifest.json', 'sw.js',
  'assets/icon.svg', 'assets/icon-512.png', 'docs/feasibility-study.md', 'README.md'];
for (const f of files) ok(existsSync(root + f), `يوجد الملف: ${f}`);

// 2) manifest صالح + أيقونات موجودة
try {
  const m = JSON.parse(readFileSync(root + 'manifest.json', 'utf8'));
  ok(m.dir === 'rtl' && m.lang === 'ar', 'manifest عربي RTL');
  ok(Array.isArray(m.icons) && m.icons.length >= 2, 'manifest: أيقونات متعددة');
  ok(m.icons.every((i) => existsSync(root + i.src)), 'manifest: مسارات الأيقونات صحيحة');
} catch { ok(false, 'manifest JSON صالح'); }

// 3) الهيكل
const html = readFileSync(root + 'index.html', 'utf8');
ok(html.includes('dir="rtl"'), 'index: اتجاه RTL');
for (const id of ['view-home', 'view-people', 'view-settings', 'sheetPerson', 'sheetDetail',
  'sheetPay', 'sheetShare', 'modalConfirm', 'statNet', 'btnAdd', 'currencySel']) {
  ok(html.includes(`id="${id}"`), `index: id=#${id}`);
}
ok(html.includes('manifest.json'), 'index: رابط manifest');
ok(html.includes('js/app.js'), 'index: تحميل app.js');

// 4) سلامة صياغة JS
try {
  execSync(`node --check "${root}js/app.js"`, { stdio: 'pipe' });
  ok(true, 'js/app.js سليم نحوًا');
} catch (e) { ok(false, 'js/app.js سليم نحوًا: ' + e.message); }
try {
  execSync(`node --check "${root}sw.js"`, { stdio: 'pipe' });
  ok(true, 'sw.js سليم نحوًا');
} catch (e) { ok(false, 'sw.js سليم نحوًا'); }

// 5) الـ Service Worker يخزّن الأصول
const sw = readFileSync(root + 'sw.js', 'utf8');
ok(sw.includes('dhimmati-v1') && sw.includes('index.html'), 'sw: استراتيجية كاش معرّفة');

// 6) منطق أساسي في app.js
const app = readFileSync(root + 'js/app.js', 'utf8');
ok(app.includes('localStorage'), 'app: حفظ محلي');
ok(app.includes('wa.me'), 'app: مشاركة واتساب');
ok(app.includes('serviceWorker'), 'app: تسجيل PWA');
ok(!/api[_-]?key|Bearer |token=/i.test(app), 'app: بلا مفاتيح/توكنات خارجية');

// 7) الصفحة العامة لفحص الجدوى
const jadwa = readFileSync(root + 'jadwa.html', 'utf8');
ok(jadwa.includes('95.9'), 'jadwa: يعرض المؤشر 95.9%');

// 8) فحص عبر HTTP إن توفر TEST_URL
const base = process.env.TEST_URL;
if (base) {
  for (const p of ['/', '/index.html', '/css/style.css', '/js/app.js', '/manifest.json', '/sw.js', '/jadwa.html']) {
    try {
      const r = await fetch(base.replace(/\/$/, '') + p);
      ok(r.status === 200, `HTTP 200: ${p}`);
    } catch (e) { ok(false, `HTTP: ${p} — ${e.message}`); }
  }
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/');
    const t = await r.text();
    ok(t.includes('ذِمّتي'), 'HTTP: المحتوى العربي يصلي سليمًا');
  } catch { ok(false, 'HTTP: محتوى عربي'); }
} else {
  console.log('ℹ️  (اختياري) TEST_URL=... لفحص عبر HTTP');
}

console.log(`\nالنتيجة: ${pass} ناجح / ${fail} فاشل`);
process.exit(fail ? 1 : 0);
