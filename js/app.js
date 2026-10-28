'use strict';
/* ═══════════ ذِمّتي — دفتر الديون الذكي (v1.2.0) ═══════════
   محلية أولاً · الحساب + المزامنة السحابية اختيارية (GitHub Gist) */

/* ─── ثوابت ─── */
const KEY = 'dhimmati.v1';
const SESSION_KEY = 'dhimmati.session';
const SEEN_KEY = 'dhimmati.seen';
const GIST_FILE = 'dhimmati.json';

const CUR = {
  ILS: { sym: '₪', label: 'شيكل' },
  JOD: { sym: 'د.أ', label: 'دينار أردني' },
  USD: { sym: '$', label: 'دولار' },
  SAR: { sym: 'ر.س', label: 'ريال سعودي' },
  AED: { sym: 'د.إ', label: 'درهم إماراتي' },
  EGP: { sym: 'ج.م', label: 'جنيه مصري' },
  MAD: { sym: 'د.م', label: 'درهم مغربي' },
  EUR: { sym: '€', label: 'يورو' }
};

const DEFAULT_CATS = ['البيت', 'الدكان'];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

const r2 = (n) => Math.round(n * 100) / 100;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function parseAmt(v) {
  let s = String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  s = s.replace(/[^\d.]/g, '');
  const parts = s.split('.');
  if (parts.length > 2) s = parts[0] + '.' + parts.slice(1).join('');
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? r2(n) : 0;
}

/* ─── الحالة ─── */
function defaults() {
  return { v: 1, currency: 'ILS', theme: 'auto', myName: '', cats: DEFAULT_CATS.slice(), people: [], log: [] };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.people) && Array.isArray(d.log)) {
        d.people.forEach((p) => { if (typeof p.bal !== 'number') p.bal = 0; });
        if (typeof d.myName !== 'string') d.myName = '';
        if (!Array.isArray(d.cats)) d.cats = DEFAULT_CATS.slice();
        return d;
      }
    }
  } catch (e) { /* بيانات تالفة */ }
  return defaults();
}

let S = load();
let curFilter = 'all';
let curCat = 'all';
let editingId = null;
let currentPid = null;
let formDir = 'credit';
let formCat = '';
let payMode = 'pay';
let payDir = 'credit';
let shareCtx = { type: 'app' };
let sheetStack = [];
let pendingInvite = null;
let deferredPrompt = null;
let undoBuf = null;
let undoTimer = null;

function save(schedule = true) {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('تعذّر الحفظ — مساحة المتصفح ممتلئة'); return; }
  if (schedule) scheduleSync();
}

const findP = (id) => S.people.find((p) => p.id === id);

/* ─── تنسيق ─── */
function fmt(n) {
  const c = CUR[S.currency] || CUR.ILS;
  const s = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return (n < 0 ? '−' : '') + s + ' ' + c.sym;
}

function fmtDate(ts) {
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function ymd() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dateInputVal(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dueTs(v) { // نهاية اليوم المختار
  if (!v) return 0;
  const t = new Date(v + 'T23:59:59').getTime();
  return isFinite(t) ? t : 0;
}

function endOfToday() { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); }

function dueInfo(p) {
  if (!p.due) return null;
  const now = Date.now();
  const day = 864e5;
  if (p.bal === 0) return { cls: 'done', text: `📅 ${fmtDate(p.due)} — انتهى ومسدّد ✔` };
  if (p.due <= endOfToday()) {
    const lateDays = Math.max(1, Math.ceil((endOfToday() - p.due) / day));
    const isToday = new Date(p.due).toDateString() === new Date().toDateString();
    return {
      cls: 'late',
      text: isToday ? `⏰ موعدك اليوم — ${fmtDate(p.due)}` : `⏰ متأخر ${lateDays} يوم (كان ${fmtDate(p.due)})`
    };
  }
  const left = Math.max(1, Math.ceil((p.due - now) / day));
  return { cls: 'soon', text: `📅 ${fmtDate(p.due)} — باقي ${left} يوم` };
}

function isOverdue(p) { return !!(p.due && p.bal !== 0 && p.due <= endOfToday()); }

function lastAct(pid) {
  let t = 0;
  for (const e of S.log) if (e.pid === pid && e.date > t) t = e.date;
  return t;
}

function sortPeople(arr) {
  return arr.slice().sort((a, b) => (lastAct(b.id) - lastAct(a.id)) || (Math.abs(b.bal) - Math.abs(a.bal)));
}

function totals() {
  let credit = 0, debt = 0;
  for (const p of S.people) {
    if (p.bal > 0) credit += p.bal;
    else debt += -p.bal;
  }
  return { credit: r2(credit), debt: r2(debt), net: r2(credit - debt) };
}

function balClass(bal) { return bal > 0 ? 'pos' : bal < 0 ? 'neg' : 'zero'; }
function balDir(bal) { return bal > 0 ? 'ليّا عليه' : bal < 0 ? 'عليّ له' : 'مسدّد'; }

function allCats() {
  const used = S.people.map((p) => p.cat).filter(Boolean);
  return Array.from(new Set([...(S.cats || []), ...used]));
}

/* ─── المظهر ─── */
const mqDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const resolved = S.theme === 'auto' ? (mqDark.matches ? 'dark' : 'light') : S.theme;
  document.documentElement.dataset.theme = resolved;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = resolved === 'dark' ? '#070C14' : '#F2F5F9';
  $('#iconMoon').classList.toggle('hidden', resolved === 'dark');
  $('#iconSun').classList.toggle('hidden', resolved !== 'dark');
  $$('#themeSeg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.tv === S.theme));
}
mqDark.addEventListener('change', () => { if (S.theme === 'auto') applyTheme(); });

/* ─── الحساب والمزامنة (GitHub Gist) ─── */
let sess = loadSession();
let syncTimer = null, syncInFlight = false, syncQueued = false;
let lastSyncAt = null, syncState = 'idle', syncErr = '';

function loadSession() {
  try { const r = localStorage.getItem(SESSION_KEY); return r ? JSON.parse(r) : null; }
  catch (e) { return null; }
}
function persistSession(x) {
  try { x ? localStorage.setItem(SESSION_KEY, JSON.stringify(x)) : localStorage.removeItem(SESSION_KEY); }
  catch (e) { /* */ }
}

async function gh(path, opts = {}) {
  if (!sess) throw new Error('غير مسجّل الدخول');
  const res = await fetch('https://api.github.com' + path, {
    method: opts.method || 'GET',
    headers: Object.assign({
      'Authorization': 'Bearer ' + sess.token,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    }, opts.headers || {}),
    body: opts.body
  });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).message || ''; } catch (e) { /* */ }
    throw new Error(res.status === 401 ? 'التوكن غير صالح أو منتهي' : 'GitHub: ' + res.status + ' ' + msg);
  }
  return res.status === 204 ? null : res.json();
}

async function findGistId() {
  const gists = await gh('/gists?per_page=100');
  const g = (gists || []).find((x) => x.files && x.files[GIST_FILE]);
  return g ? g.id : null;
}

async function pullRemote() {
  if (!sess.gistId) sess.gistId = await findGistId();
  if (!sess.gistId) { persistSession(sess); return null; }
  const g = await gh('/gists/' + sess.gistId);
  const f = g.files && g.files[GIST_FILE];
  if (!f || !f.content) return null;
  try { return JSON.parse(f.content); } catch (e) { return null; }
}

async function pushRemote(data, extraFiles) {
  const files = Object.assign({ [GIST_FILE]: { content: JSON.stringify(data) } }, extraFiles || {});
  const payload = JSON.stringify({ description: 'ذِمّتي — نسخة احتياطية', files });
  if (!sess.gistId) {
    const g = await gh('/gists', { method: 'POST', body: payload });
    sess.gistId = g.id;
    persistSession(sess);
  } else {
    await gh('/gists/' + sess.gistId, { method: 'PATCH', body: payload });
  }
}

function scheduleSync() {
  if (!sess) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, 1200);
}

async function runSync() {
  if (!sess) return;
  if (syncInFlight) { syncQueued = true; return; }
  syncInFlight = true;
  syncState = 'syncing';
  renderAccount();
  try {
    await pushRemote(S);
    lastSyncAt = Date.now();
    syncState = 'ok';
    syncErr = '';
  } catch (e) {
    syncState = 'error';
    syncErr = e.message || 'تعذّرت المزامنة';
  } finally {
    syncInFlight = false;
    renderAccount();
    if (syncQueued) { syncQueued = false; scheduleSync(); }
  }
}

async function doLogin(tokenRaw) {
  const token = String(tokenRaw || '').trim();
  if (!token) { toast('الصق التوكن أولًا'); return; }
  const btn = $('#btnLogin');
  if (btn) { btn.disabled = true; btn.textContent = 'جارٍ التحقق...'; }
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' }
    });
    if (!res.ok) throw new Error(res.status === 401 ? 'التوكن غير صالح' : 'تعذّر الاتصال بجيت هوب');
    const u = await res.json();
    sess = { token, login: u.login, gistId: null };
    persistSession(sess);
    // سحب سحابي: إذا محلي فاضي → استرجاع؛ إذا في محلي → رفع احتياطي ثم تفوّق سحابي
    const remote = await pullRemote();
    if (remote && Array.isArray(remote.people)) {
      const hadLocal = S.people.length > 0;
      if (hadLocal) {
        await pushRemote(S, { ['backup-local-' + ymd() + '-' + Date.now() + '.json']: { content: JSON.stringify(S) } });
        sess.gistId = sess.gistId; persistSession(sess);
      }
      if (!hadLocal) {
        S = Object.assign(defaults(), remote);
        save(false);
        applyTheme(); syncSettingsUI(); render();
        toast(`أهلاً ${u.login} — رجّعنا ${S.people.length} شخص من السحابة ✔`);
      } else {
        toast(`أهلاً ${u.login} — محليتك اترفعت كنسخة احتياطية، والسحابة هي الأساس ✔`);
      }
    } else {
      toast(`أهلاً ${u.login} — بنشغّل أول مزامنة ✔`);
      scheduleSync();
    }
    lastSyncAt = Date.now();
    syncState = 'ok';
    closeTop();
    renderAccount();
  } catch (e) {
    toast(e.message || 'فشل تسجيل الدخول');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'دخول ومزامنة'; }
  }
}

async function doLogout() {
  try { if (sess) await runSync(); } catch (e) { /* */ }
  const ok = await confirmBox('تسجيل الخروج؟ البيانات بتنمسح من هالجهاز وتضل محفوظة بحسابك.', 'خروج');
  if (!ok) return;
  sess = null;
  persistSession(null);
  clearTimeout(syncTimer);
  const keepCur = S.currency, keepTheme = S.theme;
  S = defaults();
  S.currency = keepCur;
  S.theme = keepTheme;
  save(false);
  applyTheme(); syncSettingsUI(); render(); renderAccount();
  toast('تم الخروج — ارجع بأي وقت وكلشي يرجع معك');
}

function syncStatusText() {
  if (!sess) return '';
  if (syncState === 'syncing') return '⏳ جارٍ المزامنة...';
  if (syncState === 'error') return '⚠️ ' + (syncErr || 'تعذّرت المزامنة — تُحاول تلقائيًا');
  if (lastSyncAt) {
    const d = new Date(lastSyncAt);
    const p = (x) => String(x).padStart(2, '0');
    return `✅ آخر مزامنة ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  return '🟢 جاهز للمزامنة';
}

function renderAccount() {
  const loggedOut = !sess;
  $('#accountLoggedOut').hidden = !loggedOut;
  $('#accountLoggedIn').hidden = loggedOut;
  if (!loggedOut) {
    $('#accountLogin').textContent = '@' + (sess.login || '');
    $('#syncInfo').textContent = syncStatusText();
  }
  const nb = $('#btnNotify');
  if (nb && 'Notification' in window) {
    if (Notification.permission === 'granted') { nb.innerHTML = '<span>🔔 تنبيهات المتصفح</span><small>مفعّلة ✔</small>'; }
    else if (Notification.permission === 'denied') { nb.innerHTML = '<span>🔔 تنبيهات المتصفح</span><small>ممنوعة من المتصفح</small>'; }
    else { nb.innerHTML = '<span>🔔 تنبيهات المتصفح</span><small>تفعيل</small>'; }
  }
}

/* ─── تنبيهات المواعيد ─── */
function ensureNotifPerm() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}

function fireDueNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch (e) { seen = {}; }
  const kday = ymd();
  let changed = false;
  S.people.forEach((p) => {
    if (!isOverdue(p)) return;
    const k = p.id + '|' + kday;
    if (seen[k]) return;
    seen[k] = 1;
    changed = true;
    try {
      new Notification('ذِمّتي — نسيت تسدّد الدين؟', {
        body: `دين ${p.name} بمبلغ ${fmt(p.bal)} — الموعد كان ${fmtDate(p.due)}`,
        icon: 'assets/icon-512.png',
        tag: k
      });
    } catch (e) { /* */ }
  });
  if (changed) {
    try {
      const keys = Object.keys(seen);
      if (keys.length > 400) keys.slice(0, keys.length - 300).forEach((kk) => delete seen[kk]);
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
    } catch (e) { /* */ }
  }
}

function scheduleDueChecks() {
  fireDueNotifications();
  setInterval(fireDueNotifications, 6 * 3600e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fireDueNotifications(); });
}

/* ─── العرض ─── */
function rowHTML(p) {
  const initial = esc((p.name || '?').trim().charAt(0) || '?');
  const cls = balClass(p.bal);
  const bits = [p.note, p.cat, balDir(p.bal)].filter(Boolean);
  if (isOverdue(p)) bits.push('⏰ متأخر');
  const sub = bits.join(' · ');
  return `<button type="button" class="li" data-id="${p.id}">
    <span class="avatar ${cls}">${initial}</span>
    <span class="li-main"><b>${esc(p.name)}</b><small>${esc(sub)}</small></span>
    <span class="li-amt"><b class="${cls}">${fmt(p.bal)}</b><small>${balDir(p.bal)}</small></span>
  </button>`;
}

function render() {
  const t = totals();
  $('#statCredit').textContent = fmt(t.credit);
  $('#statDebt').textContent = fmt(t.debt);
  const net = $('#statNet');
  net.textContent = fmt(t.net);
  net.className = 'hero-amount ' + balClass(t.net);
  $('#peopleCount').textContent = S.people.length ? S.people.length + ' شخص' : '';

  // شريط المتأخرات
  const od = S.people.filter(isOverdue);
  const strip = $('#overdueStrip');
  strip.classList.toggle('hidden', od.length === 0);
  if (od.length) {
    $('#overdueCount').textContent = od.length + (od.length === 1 ? ' دين متأخر' : ' ديون متأخرة');
    $('#overdueNames').textContent = od.slice(0, 3).map((p) => p.name).join('، ') + (od.length > 3 ? ' …' : '');
  }

  const sorted = sortPeople(S.people);
  const recent = sorted.slice(0, 5);
  $('#homeList').innerHTML = recent.map(rowHTML).join('');
  $('#homeList').classList.toggle('hidden', recent.length === 0);
  $('#homeEmpty').classList.toggle('hidden', recent.length !== 0);

  renderPeopleView();
  renderCatFilter();
}

function renderCatFilter() {
  const cats = allCats();
  const box = $('#catFilter');
  box.classList.toggle('hidden', cats.length === 0);
  if (!cats.length) return;
  const used = (c) => S.people.some((p) => p.cat === c);
  box.innerHTML =
    `<button type="button" class="chip ${curCat === 'all' ? 'active' : ''}" data-cat="all">كل التصنيفات</button>` +
    cats.map((c) =>
      `<button type="button" class="chip ${curCat === c ? 'active' : ''} ${used(c) ? '' : 'chip-unused'}" data-cat="${esc(c)}">${esc(c)}</button>`
    ).join('');
}

function renderPeopleView() {
  const q = ($('#search').value || '').trim();
  let arr = sortPeople(S.people);
  if (q) arr = arr.filter((p) => p.name.includes(q));
  if (curFilter === 'credit') arr = arr.filter((p) => p.bal > 0);
  if (curFilter === 'debit') arr = arr.filter((p) => p.bal < 0);
  if (curFilter === 'settled') arr = arr.filter((p) => p.bal === 0);
  if (curFilter === 'overdue') arr = arr.filter(isOverdue);
  if (curCat !== 'all') arr = arr.filter((p) => p.cat === curCat);

  $('#peopleList').innerHTML = arr.map(rowHTML).join('');
  const empty = arr.length === 0;
  $('#peopleList').classList.toggle('hidden', empty);
  const msg = $('#peopleEmpty');
  msg.classList.toggle('hidden', !empty);
  if (empty) msg.querySelector('p').textContent =
    S.people.length === 0 ? 'دفترك فاضي — ابدأ بإضافة شخص.' : 'ما لقينا حدا بهذا الوصف.';
}

function showView(v) {
  $$('.view').forEach((el) => el.classList.toggle('hidden', el.id !== 'view-' + v));
  $$('.tab[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  window.scrollTo({ top: 0 });
  if (v === 'settings') { syncSettingsUI(); renderAccount(); renderCatManage(); }
}

/* ─── الطبقات ─── */
function openSheet(el) {
  sheetStack.push(el);
  el.hidden = false;
  $('#backdrop').hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $('#backdrop').classList.add('show');
    el.classList.add('open');
    document.body.classList.add('no-scroll');
  }));
}

function closeTop() {
  const el = sheetStack.pop();
  if (!el) return;
  el.classList.remove('open');
  if (sheetStack.length === 0) {
    $('#backdrop').classList.remove('show');
    document.body.classList.remove('no-scroll');
  }
  setTimeout(() => {
    el.hidden = true;
    if (sheetStack.length === 0) $('#backdrop').hidden = true;
  }, 300);
}

function toast(msg, actionLabel, actionCb) {
  const t = document.createElement('div');
  t.className = 'toast';
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);
  if (actionLabel && actionCb) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 't-act';
    b.textContent = actionLabel;
    b.onclick = () => { actionCb(); t.classList.remove('show'); setTimeout(() => t.remove(), 300); };
    t.appendChild(b);
  }
  $('#toasts').appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  const life = actionLabel ? 7000 : 2600;
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 350);
  }, life);
}

function confirmBox(msg, yesLabel = 'نعم، متأكد') {
  return new Promise((res) => {
    const m = $('#modalConfirm');
    $('#confirmMsg').textContent = msg;
    $('#confirmYes').textContent = yesLabel;
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('open'));
    const done = (v) => {
      m.classList.remove('open');
      setTimeout(() => { m.hidden = true; }, 220);
      $('#confirmYes').onclick = null;
      $('#confirmNo').onclick = null;
      res(v);
    };
    $('#confirmYes').onclick = () => done(true);
    $('#confirmNo').onclick = () => done(false);
    m.onclick = (e) => { if (e.target === m) done(false); };
  });
}

/* ─── العمليات ─── */
function addPerson({ name, dir, amount, note, cat, due }) {
  const p = {
    id: uid(),
    name: name.trim(),
    note: (note || '').trim(),
    cat: (cat || '').trim(),
    due: due || 0,
    created: Date.now(),
    bal: dir === 'credit' ? amount : -amount
  };
  S.people.push(p);
  S.log.push({ id: uid(), pid: p.id, kind: 'add', amount, dir, date: Date.now() });
  save();
  render();
  return p;
}

function applyPay(pid, amount, note) {
  const p = findP(pid);
  if (!p) return;
  const before = p.bal;
  const applied = Math.min(Math.abs(before), amount);
  if (applied <= 0) return;
  p.bal = before > 0 ? r2(before - applied) : r2(before + applied);
  S.log.push({ id: uid(), pid, kind: 'pay', amount: applied, note: (note || '').trim(), date: Date.now() });
  save();
  render();
}

function applyDebt(pid, amount, dir) {
  const p = findP(pid);
  if (!p) return;
  p.bal = r2(p.bal + (dir === 'credit' ? amount : -amount));
  S.log.push({ id: uid(), pid, kind: 'add', amount, dir, date: Date.now() });
  save();
  render();
}

function settle(pid) {
  const p = findP(pid);
  if (!p || p.bal === 0) return;
  const amount = Math.abs(p.bal);
  p.bal = 0;
  S.log.push({ id: uid(), pid, kind: 'settle', amount, date: Date.now() });
  save();
  render();
}

function deletePerson(pid) {
  const p = findP(pid);
  if (!p) return;
  const logs = S.log.filter((e) => e.pid === pid);
  undoBuf = { p, logs };
  S.people = S.people.filter((x) => x.id !== pid);
  S.log = S.log.filter((e) => e.pid !== pid);
  save();
  render();
  clearTimeout(undoTimer);
  toast(`انحذف «${p.name}»`, 'تراجع ↩', () => {
    if (!undoBuf) return;
    S.people.push(undoBuf.p);
    S.log.push(...undoBuf.logs);
    undoBuf = null;
    save();
    render();
    toast('رجع ✔');
  });
  undoTimer = setTimeout(() => { undoBuf = null; }, 7500);
}

/* ─── نموذج الشخص ─── */
function renderCatPicker() {
  const box = $('#catChips');
  const cats = allCats();
  box.innerHTML = cats.length
    ? cats.map((c) =>
        `<button type="button" class="cat-chip ${formCat === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`
      ).join('') +
      `<button type="button" class="cat-chip add" id="catAddBtn">+ جديد</button>`
    : `<button type="button" class="cat-chip add" id="catAddBtn">+ تصنيف جديد</button>`;
  $('#quickCatRow').hidden = true;
}

function openPersonForm(p = null) {
  editingId = p ? p.id : null;
  formDir = p ? (p.bal >= 0 ? 'credit' : 'debit') : 'credit';
  formCat = p ? (p.cat || '') : '';
  $('#personFormTitle').textContent = p ? 'تعديل الشخص' : 'إضافة شخص';
  $('#pName').value = p ? p.name : '';
  $('#pNote').value = p ? p.note || '' : '';
  $('#pAmount').value = '';
  $('#pDue').value = p && p.due ? dateInputVal(p.due) : '';
  $('#amountField').hidden = !!p;
  $('#amountField2').hidden = !!p;
  $$('#pDir .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.dir === formDir));
  renderCatPicker();
  openSheet($('#sheetPerson'));
  setTimeout(() => $('#pName').focus(), 350);
}

/* ─── التفاصيل ─── */
function openDetail(pid) {
  currentPid = pid;
  renderDetail();
  openSheet($('#sheetDetail'));
}

function renderDetail() {
  const p = findP(currentPid);
  if (!p) { if (sheetStack.includes($('#sheetDetail'))) closeTop(); return; }

  const cls = balClass(p.bal);
  const di = dueInfo(p);
  const logs = S.log.filter((e) => e.pid === p.id).sort((a, b) => b.date - a.date).slice(0, 30);

  const logHTML = logs.length
    ? logs.map((e) => {
        let label = '', val = '', lc = '';
        if (e.kind === 'add') {
          label = e.dir === 'credit' ? 'دين جديد (ليّا عليه)' : 'دين جديد (أنا عليه)';
          val = (e.dir === 'credit' ? '+' : '−') + fmt(e.amount);
          lc = e.dir === 'credit' ? 'l-pos' : 'l-neg';
        } else if (e.kind === 'pay') {
          label = 'دفعة' + (e.note ? ` — ${esc(e.note)}` : '');
          val = '−' + fmt(e.amount);
          lc = 'l-neg';
        } else {
          label = 'تسديد كامل 🎉';
          val = fmt(e.amount);
          lc = 'l-pos';
        }
        return `<div class="log-row"><span><b>${label}</b><small>${fmtDate(e.date)}</small></span><b class="${lc}">${val}</b></div>`;
      }).join('')
    : '<div class="log-empty">ما في سجل بعد.</div>';

  $('#detailBody').innerHTML = `
    <div class="d-head">
      <div class="d-avatar ${cls}" style="${cls === 'pos' ? 'background:linear-gradient(135deg,#16A34A,#0E7C3B)' : cls === 'neg' ? 'background:linear-gradient(135deg,#F43F5E,#BE123C)' : 'background:linear-gradient(135deg,#64748B,#475569)'}">${esc(p.name.charAt(0))}</div>
      <h3>${esc(p.name)}</h3>
      ${p.cat ? `<div class="d-cat">🏷 ${esc(p.cat)}</div>` : ''}
      ${p.note ? `<div class="d-note">${esc(p.note)}</div>` : ''}
      <div class="d-amount ${cls}">${p.bal === 0 ? 'مسدّد بالكامل ✔' : fmt(p.bal) + ' — ' + balDir(p.bal)}</div>
      ${di ? `<div class="due-chip ${di.cls}">${di.text}</div>` : ''}
    </div>
    <div class="d-actions">
      <button type="button" class="d-act primary" data-act="pay" ${p.bal === 0 ? 'disabled style="opacity:.45"' : ''}><i>💸</i>دفعة</button>
      <button type="button" class="d-act primary" data-act="debt"><i>➕</i>دين جديد</button>
      <button type="button" class="d-act" data-act="share"><i>📤</i>مشاركة/طلب</button>
      ${p.bal > 0 ? '<button type="button" class="d-act" data-act="remind"><i>🔔</i>تذكير</button>' : ''}
      <button type="button" class="d-act" data-act="due"><i>📅</i>الموعد</button>
      <button type="button" class="d-act" data-act="edit"><i>✏️</i>تعديل</button>
      <button type="button" class="d-act ${p.bal !== 0 ? 'primary' : ''}" data-act="settle" ${p.bal === 0 ? 'disabled style="opacity:.45"' : ''}><i>✅</i>تسديد كامل</button>
      <button type="button" class="d-act danger" data-act="del"><i>🗑</i>حذف</button>
    </div>
    <div class="d-log-title">السجل</div>
    <div class="d-log">${logHTML}</div>
    <div style="height:6px"></div>
    <button type="button" class="btn btn-ghost btn-block" data-act="close">إغلاق</button>
  `;
}

/* ─── الدفعة/الدين ─── */
function openPaySheet(mode) {
  const p = findP(currentPid);
  if (!p) return;
  payMode = mode;
  payDir = p.bal >= 0 ? 'credit' : 'debit';
  $('#payAmount').value = '';
  $('#payNote').value = '';
  if (mode === 'pay') {
    $('#payTitle').textContent = 'تسجيل دفعة';
    $('#payRemain').textContent = 'المتبقي: ' + fmt(p.bal);
    $('#payDirField').hidden = true;
    $('#payNoteField').hidden = false;
  } else {
    $('#payTitle').textContent = 'دين جديد';
    $('#payDirField').hidden = p.bal !== 0;
    $('#payNoteField').hidden = true;
    if (p.bal === 0) {
      payDir = 'credit';
      $$('#payDir .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.dir === payDir));
    }
    $('#payRemain').textContent = 'الرصيد الحالي: ' + fmt(p.bal);
  }
  openSheet($('#sheetPay'));
  setTimeout(() => $('#payAmount').focus(), 350);
}

/* ─── الموعد ─── */
function openDueSheet() {
  const p = findP(currentPid);
  if (!p) return;
  $('#dueDate').value = p.due ? dateInputVal(p.due) : '';
  $('#dueClear').hidden = !p.due;
  openSheet($('#sheetDue'));
}

/* ─── المشاركة ─── */
function appURL() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

function inviteURL(p) {
  const u = new URL(appURL());
  u.searchParams.set('req', '1');
  u.searchParams.set('n', p.name);
  u.searchParams.set('a', String(Math.abs(p.bal)));
  u.searchParams.set('d', p.bal >= 0 ? 'credit' : 'debit');
  if (S.myName) u.searchParams.set('s', S.myName);
  if (p.note) u.searchParams.set('note', p.note);
  return u.toString();
}

function signOff() { return S.myName ? `\n— ${S.myName}` : ''; }

function shareTextApp() {
  return `بدك دفتر ذكي للي عليك واللي ليك؟ «ذِمّتي» بيسجّل الديون، بيفكّرك بالمواعيد، وببلمسة بتوصل لواتساب — عربي بالكامل 👉 ${appURL()}`;
}

function shareTextPerson(p) {
  const amt = fmt(Math.abs(p.bal));
  const url = p.bal !== 0 ? inviteURL(p) : appURL();
  if (p.bal > 0) {
    return `يا ${p.name}، تذكير لطيف: بذمتك عندي ${amt} 😊${p.due ? ` (الموعد كان ${fmtDate(p.due)})` : ''} والطلب مسجّل برابط 👉 ${url}${signOff()}`;
  }
  if (p.bal < 0) {
    return `يا ${p.name}، بذمّتي عليك ${amt} 💸 ولسا بدي أسدّدلك — فتح الرابط بينزّل المبلغ بدفترك على طول 👉 ${url}${signOff()}`;
  }
  return `يا ${p.name}، ✅ تم انتهاء الدين وحساباتنا خلصت تمام — يلا سجّل أنت كمان بـ«ذِمّتي» 👉 ${url}${signOff()}`;
}

function shareTextRemind(p) {
  const amt = fmt(Math.abs(p.bal));
  return `يا ${p.name}، نسيت تسدّد الدين 😅 — ${amt}${p.due ? ` والموعد كان ${fmtDate(p.due)}` : ''}. تذكير لطيف من دفتر «ذِمّتي» 👉 ${p.bal > 0 ? inviteURL(p) : appURL()}${signOff()}`;
}

function shareTextSummary() {
  const t = totals();
  const top = sortPeople(S.people).find((q) => q.bal > 0);
  let topCat = '';
  const sums = {};
  S.people.forEach((p) => { if (p.cat && p.bal > 0) sums[p.cat] = r2((sums[p.cat] || 0) + p.bal); });
  const ent = Object.entries(sums).sort((a, b) => b[1] - a[1])[0];
  if (ent) topCat = ` · أعلى تصنيف: ${ent[0]} ${fmt(ent[1])}`;
  return `ملخّص دفترك بـ«ذِمّتي»: مستحق ليّا ${fmt(t.credit)} · مستحق منّي ${fmt(t.debt)} · الصافي ${fmt(t.net)}${top ? ` · وأكبر مدين: ${top.name}` : ''}${topCat} — نظّم ذمّك وبذمّتك 👉 ${appURL()}${signOff()}`;
}

function currentShareText() {
  if (shareCtx.type === 'person') {
    const p = findP(shareCtx.pid);
    if (p) return shareTextPerson(p);
  }
  if (shareCtx.type === 'remind') {
    const p = findP(shareCtx.pid);
    if (p) return shareTextRemind(p);
  }
  if (shareCtx.type === 'summary') return shareTextSummary();
  return shareTextApp();
}

function openShare(ctx) {
  shareCtx = ctx;
  const isPerson = ctx.type === 'person';
  const isRemind = ctx.type === 'remind';
  const p = (isPerson || isRemind) ? findP(ctx.pid) : null;
  if (ctx.type === 'summary') $('#shareTitle').textContent = 'ملخّص ذمّتي';
  else if (isRemind) $('#shareTitle').textContent = 'تذكير لـ' + (p ? p.name : '');
  else if (isPerson) $('#shareTitle').textContent = 'شارك مع ' + (p ? p.name : '');
  else $('#shareTitle').textContent = 'شارك ذِمّتي';

  $('#sharePreview').textContent = currentShareText();
  $('#shLink').classList.toggle('hidden', !(isPerson && p && p.bal !== 0));
  $('#shNative').classList.toggle('hidden', typeof navigator.share !== 'function');
  openSheet($('#sheetShare'));
}

/* ─── بطاقة PNG ─── */
function roundRectPath(x, X, Y, w, h, r) {
  if (x.roundRect) { x.beginPath(); x.roundRect(X, Y, w, h, r); return; }
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + w, Y, X + w, Y + h, r);
  x.arcTo(X + w, Y + h, X, Y + h, r);
  x.arcTo(X, Y + h, X, Y, r);
  x.arcTo(X, Y, X + w, Y, r);
  x.closePath();
}

function drawFrame(x, W, H) {
  const g = x.createLinearGradient(W, 0, 0, H);
  g.addColorStop(0, '#12857A');
  g.addColorStop(0.55, '#0F766E');
  g.addColorStop(1, '#083F39');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(255,255,255,.06)';
  x.beginPath(); x.arc(130, 130, 230, 0, 7); x.fill();
  x.fillStyle = 'rgba(0,0,0,.10)';
  x.beginPath(); x.arc(980, 990, 300, 0, 7); x.fill();
  x.textAlign = 'right';
  x.direction = 'rtl';
  x.fillStyle = '#E9B949';
  x.font = '900 62px "Segoe UI", Tahoma, "Noto Sans Arabic", sans-serif';
  x.fillText('ذِمّتي', W - 84, 128);
  x.fillStyle = 'rgba(255,255,255,.78)';
  x.font = '500 32px "Segoe UI", Tahoma, "Noto Sans Arabic", sans-serif';
  x.fillText('دفتر الديون الذكي', W - 84, 178);
}

function drawFooter(x, W, H) {
  const F = '"Segoe UI", Tahoma, "Noto Sans Arabic", sans-serif';
  x.textAlign = 'center';
  x.fillStyle = '#E9B949';
  x.font = '800 38px ' + F;
  x.fillText('افتح دفترك أنت كمان 👇', W / 2, 872);
  x.fillStyle = '#FFFFFF';
  x.font = '800 46px ' + F;
  x.fillText(appURL().replace(/^https?:\/\//, ''), W / 2, 944);
  x.fillStyle = 'rgba(255,255,255,.62)';
  x.font = '500 30px ' + F;
  x.fillText('كل بياناتك تبقى عندك — من غير تسجيل', W / 2, 1012);
}

async function makeCard() {
  const W = 1080, H = 1080;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const F = '"Segoe UI", Tahoma, "Noto Sans Arabic", sans-serif';
  const sym = (CUR[S.currency] || CUR.ILS).sym;
  const p = shareCtx.type === 'person' ? findP(shareCtx.pid) : null;

  drawFrame(x, W, H);
  roundRectPath(x, 80, 268, W - 160, 500, 44);
  x.fillStyle = 'rgba(255,255,255,.10)';
  x.fill();
  x.strokeStyle = 'rgba(255,255,255,.26)';
  x.lineWidth = 2;
  x.stroke();
  x.direction = 'rtl';
  x.textAlign = 'center';

  if (shareCtx.type === 'summary') {
    const t = totals();
    const top = sortPeople(S.people).find((q) => q.bal > 0);
    x.fillStyle = 'rgba(255,255,255,.85)';
    x.font = `700 42px ${F}`;
    x.fillText('ملخّص ذمّتي', W / 2, 356);
    const rows = [
      ['مستحق ليّا', fmt(t.credit), '#B9FFDD'],
      ['مستحق منّي', fmt(t.debt), '#FFC9D4'],
      ['الصافي', fmt(t.net), '#FFFFFF']
    ];
    rows.forEach((r, i) => {
      const y = 444 + i * 92;
      x.textAlign = 'right';
      x.fillStyle = 'rgba(255,255,255,.75)';
      x.font = `600 38px ${F}`;
      x.fillText(r[0], W - 150, y + 12);
      x.textAlign = 'left';
      x.fillStyle = r[2];
      x.font = `900 52px ${F}`;
      x.fillText(r[1], 150, y + 14);
    });
    x.textAlign = 'center';
    x.fillStyle = 'rgba(255,255,255,.85)';
    x.font = `600 34px ${F}`;
    x.fillText(top ? `وأكبر مدين: ${top.name}` : `${S.people.length} شخص بدفترك`, W / 2, 726);
    drawFooter(x, W, H);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }

  if (p) {
    const cls = balClass(p.bal);
    const label = p.bal > 0 ? 'تذكير لطيف بالذمة' : p.bal < 0 ? 'ذمّتي عليك' : 'تم انتهاء الدين — برافو!';
    x.fillStyle = 'rgba(255,255,255,.85)';
    x.font = `700 42px ${F}`;
    x.fillText(label, W / 2, 372);
    x.fillStyle = '#FFFFFF';
    x.font = `900 76px ${F}`;
    x.fillText(p.name, W / 2, 490);
    x.fillStyle = cls === 'neg' ? '#FFD3DC' : cls === 'pos' ? '#D6FFEC' : '#EAF3F1';
    x.font = `900 118px ${F}`;
    x.fillText(Math.abs(p.bal).toLocaleString('en-US') + ' ' + sym, W / 2, 638);
    x.fillStyle = 'rgba(255,255,255,.8)';
    x.font = `600 36px ${F}`;
    x.fillText(p.bal === 0 ? 'مسدّد بالكامل ✔' : balDir(p.bal), W / 2, 718);
  } else {
    x.fillStyle = 'rgba(255,255,255,.85)';
    x.font = `700 44px ${F}`;
    x.fillText('نظّم ذمّك وبذمّتك', W / 2, 386);
    x.fillStyle = '#FFFFFF';
    x.font = `900 130px ${F}`;
    x.fillText('ذِمّتي', W / 2, 540);
    x.fillStyle = 'rgba(255,255,255,.85)';
    x.font = `600 40px ${F}`;
    x.fillText('دفتر الديون اللي ما بينسى', W / 2, 626);
    x.fillStyle = 'rgba(255,255,255,.7)';
    x.font = `500 34px ${F}`;
    x.fillText('عربي · مواعيد · تصنيفات · بياناتك عندك', W / 2, 700);
  }
  drawFooter(x, W, H);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

async function shareCard() {
  try {
    const blob = await makeCard();
    const file = new File([blob], 'dhimmati.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'ذِمّتي' }); }
      catch (e) { /* ألغى */ }
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'dhimmati-card.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('انزّلت الصورة ✔');
    }
  } catch (e) {
    toast('تعذّر توليد الصورة');
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('انتسخ النص ✔');
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('انتسخ النص ✔'); }
    catch (e2) { toast('ما قدرنا ننسخ'); }
    ta.remove();
  }
}

function dl(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ─── رابط الطلب ─── */
function cleanURL() {
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* */ }
}

function handleInvite() {
  let q;
  try { q = new URLSearchParams(location.search); } catch (e) { return; }
  if (q.get('req') !== '1') return;
  const seenKey = 'dhimmati.req:' + location.search;
  if (sessionStorage.getItem(seenKey)) { cleanURL(); return; }
  sessionStorage.setItem(seenKey, '1');

  const sender = (q.get('s') || '').trim() || 'الطرف الآخر';
  const amount = parseAmt(q.get('a'));
  const origDir = q.get('d') === 'debit' ? 'debit' : 'credit';
  const recDir = origDir === 'credit' ? 'debit' : 'credit';
  const note = (q.get('note') || '').trim();
  const toName = (q.get('n') || '').trim();
  if (!amount) { cleanURL(); return; }

  pendingInvite = { sender, amount, recDir, note };
  $('#inviteMsg').textContent = (toName ? `يا ${toName}، ` : '') +
    `${sender} بعتلك طلب ذمّة — بدي تسجّله بدفترك الآن؟`;
  $('#inviteSum').innerHTML =
    `<b>${fmt(amount)}</b><span>${recDir === 'debit' ? 'أنا عليه' : 'ليّا عليه'} ${esc(sender)}</span>`;
  cleanURL();
  openSheet($('#sheetInvite'));
}

function acceptInvite() {
  if (!pendingInvite) { closeTop(); return; }
  const { sender, amount, recDir, note } = pendingInvite;
  const p = addPerson({
    name: sender,
    dir: recDir,
    amount,
    note: note ? `رابط طلب — ${note}` : 'رابط طلب'
  });
  pendingInvite = null;
  closeTop();
  showView('home');
  toast('انسجّل بطلبك ✔');
  setTimeout(() => openDetail(p.id), 350);
}

/* ─── تثبيت PWA ─── */
function wireInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!sessionStorage.getItem('dhimmati.banner')) $('#installBanner').classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => {
    $('#installBanner').classList.add('hidden');
    deferredPrompt = null;
    toast('انثبّت ذِمّتي على جهازك ✔');
  });
}

/* ─── الإعدادات ─── */
function syncSettingsUI() {
  $$('#themeSeg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.tv === S.theme));
  $('#currencySel').value = S.currency;
  $('#myName').value = S.myName || '';
}

function renderCatManage() {
  const box = $('#catManage');
  const cats = allCats();
  box.innerHTML = cats.length
    ? cats.map((c) => `
        <div class="cat-manage-row">
          <span>🏷 ${esc(c)}</span>
          <button type="button" class="cat-del" data-catdel="${esc(c)}" title="حذف">✕</button>
        </div>`).join('')
    : '<div class="log-empty">ما في تصنيفات — أضف واحدًا تحت.</div>';
}

function exportData() {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  dl(blob, `dhimmati-backup-${ymd()}.json`);
  toast('تم التصدير ✔');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const d = JSON.parse(reader.result);
      if (!d || !Array.isArray(d.people) || !Array.isArray(d.log)) throw new Error('bad');
      const ok = await confirmBox('استيراد النسخة بيستبدل كل البيانات الحالية. متأكد؟', 'استيراد');
      if (!ok) return;
      S = Object.assign(defaults(), d);
      save();
      applyTheme();
      render();
      syncSettingsUI();
      renderCatManage();
      toast('انتست النسخة ✔');
    } catch (e) {
      toast('ملف غير صالح');
    }
  };
  reader.readAsText(file);
}

function addSample() {
  const now = Date.now();
  const rows = [
    { name: 'سامي', note: 'قرض العرس', cat: 'البيت', dir: 'credit', amount: 750, d: 6, due: -2 },
    { name: 'عمّي بشار', note: 'سلفة', cat: 'الدكان', dir: 'debit', amount: 300, d: 4, due: 0 },
    { name: 'محمود', note: 'نص تلفون', cat: '', dir: 'credit', amount: 450, d: 2, due: 5 }
  ];
  rows.forEach((r) => {
    const p = {
      id: uid(), name: r.name, note: r.note, cat: r.cat,
      due: r.due ? now + r.due * 864e5 : 0,
      created: now - r.d * 864e5,
      bal: r.dir === 'credit' ? r.amount : -r.amount
    };
    S.people.push(p);
    S.log.push({ id: uid(), pid: p.id, kind: 'add', amount: r.amount, dir: r.dir, date: now - r.d * 864e5 });
  });
  save();
  render();
  toast('انضافت بيانات تجريبية ✔');
}

/* ─── الأحداث ─── */
function wire() {
  // التنقل
  $$('.tab[data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.goto)));
  $('#btnAdd').addEventListener('click', () => openPersonForm());
  $('#btnFirstAdd').addEventListener('click', () => openPersonForm());
  $('#overdueStrip').addEventListener('click', () => {
    curFilter = 'overdue';
    $$('#filters .chip').forEach((x) => x.classList.toggle('active', x.dataset.filter === 'overdue'));
    renderPeopleView();
    showView('people');
  });

  // فتح شخص / إغلاق / عناصر ديناميكية
  document.addEventListener('click', (e) => {
    const li = e.target.closest('.li[data-id]');
    if (li) { openDetail(li.dataset.id); return; }
    if (e.target.closest('[data-close]')) { closeTop(); return; }
    if (e.target.closest('#btnOpenLogin')) { $('#loginToken').value = ''; openSheet($('#sheetLogin')); setTimeout(() => $('#loginToken').focus(), 350); return; }
    if (e.target.closest('#btnLogout')) { doLogout(); return; }
    const catDel = e.target.closest('[data-catdel]');
    if (catDel) {
      const c = catDel.dataset.catdel;
      S.cats = (S.cats || []).filter((x) => x !== c);
      save(); renderCatManage(); renderCatFilter();
      toast('انحذف التصنيف (الأشخاص يضلّوا عليه)');
      return;
    }
    const fcat = e.target.closest('#catFilter [data-cat]');
    if (fcat) {
      curCat = fcat.dataset.cat;
      renderCatFilter();
      renderPeopleView();
      return;
    }
    const pcat = e.target.closest('#catChips .cat-chip');
    if (pcat) {
      if (pcat.id === 'catAddBtn') {
        $('#quickCatRow').hidden = !$('#quickCatRow').hidden;
        if (!$('#quickCatRow').hidden) setTimeout(() => $('#quickCatName').focus(), 60);
      } else {
        formCat = formCat === pcat.dataset.cat ? '' : pcat.dataset.cat;
        renderCatPicker();
      }
      return;
    }
  });

  // المظهر
  $('#btnTheme').addEventListener('click', () => {
    const resolved = document.documentElement.dataset.theme;
    S.theme = resolved === 'dark' ? 'light' : 'dark';
    save();
    applyTheme();
    syncSettingsUI();
  });
  $$('#themeSeg .seg-btn').forEach((b) =>
    b.addEventListener('click', () => { S.theme = b.dataset.tv; save(false); applyTheme(); }));

  // البحث والفِلترات
  $('#search').addEventListener('input', renderPeopleView);
  $$('#filters .chip').forEach((c) =>
    c.addEventListener('click', () => {
      curFilter = c.dataset.filter;
      $$('#filters .chip').forEach((x) => x.classList.toggle('active', x === c));
      renderPeopleView();
    }));

  // نموذج الشخص
  $$('#pDir .seg-btn').forEach((b) =>
    b.addEventListener('click', () => {
      formDir = b.dataset.dir;
      $$('#pDir .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    }));

  $('#formPerson').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#pName').value.trim();
    if (!name) { toast('اكتب الاسم أولًا'); $('#pName').focus(); return; }

    // تصنيف سريع جديد
    const quick = $('#quickCatName').value.trim();
    if (quick) {
      formCat = quick;
      if (!S.cats.includes(quick)) S.cats.push(quick);
    }
    const due = dueTs($('#pDue').value);
    if (due) ensureNotifPerm();

    if (editingId) {
      const p = findP(editingId);
      if (p) {
        p.name = name;
        p.note = $('#pNote').value.trim();
        p.cat = formCat;
        p.due = due;
        save();
        render();
      }
      closeTop();
      if (sheetStack.includes($('#sheetDetail'))) renderDetail();
      toast('انحفظ ✔');
      return;
    }

    const amount = parseAmt($('#pAmount').value);
    if (!amount) { toast('اكتب مبلغًا صحيحًا'); $('#pAmount').focus(); return; }
    addPerson({ name, dir: formDir, amount, note: $('#pNote').value, cat: formCat, due });
    closeTop();
    toast('انضاف ✔');
  });

  // التفاصيل
  $('#detailBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const p = findP(currentPid);
    if (!p) return;

    if (act === 'pay') openPaySheet('pay');
    else if (act === 'debt') openPaySheet('debt');
    else if (act === 'share') openShare({ type: 'person', pid: p.id });
    else if (act === 'remind') openShare({ type: 'remind', pid: p.id });
    else if (act === 'due') openDueSheet();
    else if (act === 'edit') openPersonForm(p);
    else if (act === 'settle') {
      const ok = await confirmBox(`تسديد كامل بمبلغ ${fmt(Math.abs(p.bal))}؟`, 'تسديد');
      if (ok) {
        const hadDue = !!p.due;
        settle(p.id);
        renderDetail();
        toast('تسدّد بالكامل 🎉');
        if (hadDue) {
          const ask = await confirmBox('ابعت إشعار «تم انتهاء الدين» للطرف الآخر؟', 'ابعت');
          if (ask) setTimeout(() => openShare({ type: 'person', pid: p.id }), 350);
        }
      }
    } else if (act === 'del') {
      const ok = await confirmBox(`حذف «${p.name}» وسجله نهائيًا؟ (في تراجع لـ7 ثواني)`, 'حذف');
      if (ok) { deletePerson(p.id); closeTop(); }
    } else if (act === 'close') closeTop();
  });

  // الدفعة/الدين
  $$('#payDir .seg-btn').forEach((b) =>
    b.addEventListener('click', () => {
      payDir = b.dataset.dir;
      $$('#payDir .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    }));

  $('#formPay').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseAmt($('#payAmount').value);
    if (!amount) { toast('اكتب مبلغًا صحيحًا'); $('#payAmount').focus(); return; }
    const p = findP(currentPid);
    if (!p) return;
    const note = $('#payNote').value.trim();

    if (payMode === 'pay') {
      if (amount > Math.abs(p.bal)) { toast('المبلغ أكبر من الرصيد — استخدم «تسديد كامل»'); return; }
      applyPay(p.id, amount, note);
      toast('سُجّلت الدفعة ✔');
    } else {
      const dir = p.bal !== 0 ? (p.bal > 0 ? 'credit' : 'debit') : payDir;
      applyDebt(p.id, amount, dir);
      toast('انضاف الدين ✔');
    }
    closeTop();
    renderDetail();
  });

  // ورقة الموعد
  $('#formDue').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = findP(currentPid);
    if (!p) return;
    p.due = dueTs($('#dueDate').value);
    if (p.due) ensureNotifPerm();
    save();
    closeTop();
    renderDetail();
    render();
    toast(p.due ? 'انحفظ الموعد ✔' : 'انشال الموعد');
  });
  $('#dueClear').addEventListener('click', () => {
    const p = findP(currentPid);
    if (!p) return;
    p.due = 0;
    save();
    closeTop();
    renderDetail();
    render();
    toast('انشال الموعد');
  });

  // المشاركة
  $$('.js-share-app').forEach((b) => b.addEventListener('click', () => openShare({ type: 'app' })));
  $('#btnShareSummary').addEventListener('click', () => openShare({ type: 'summary' }));
  $('#shWhats').addEventListener('click', () => {
    window.open('https://wa.me/?text=' + encodeURIComponent(currentShareText()), '_blank', 'noopener');
  });
  $('#shCopy').addEventListener('click', () => copyText(currentShareText()));
  $('#shCard').addEventListener('click', shareCard);
  $('#shLink').addEventListener('click', () => {
    const p = findP(shareCtx.pid);
    if (p && p.bal !== 0) copyText(inviteURL(p));
    else toast('ما في مبلغ مفتوح للمشاركة');
  });
  $('#shNative').addEventListener('click', async () => {
    try { await navigator.share({ title: 'ذِمّتي', text: currentShareText() }); }
    catch (e) { /* ألغى */ }
  });

  // الدعوة
  $('#btnInviteAccept').addEventListener('click', acceptInvite);
  $('#btnInviteLater').addEventListener('click', () => {
    pendingInvite = null;
    closeTop();
    toast('تمام — الدفتر مفتوح قدامك');
  });

  // الدخول
  $('#btnLogin').addEventListener('click', () => doLogin($('#loginToken').value));
  $('#loginToken').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin($('#loginToken').value); });

  // التنبيهات
  $('#btnNotify').addEventListener('click', () => {
    if (!('Notification' in window)) { toast('متصفحك ما بيدعم التنبيهات'); return; }
    if (Notification.permission === 'granted') { toast('التنبيهات مفعّلة ✔'); return; }
    if (Notification.permission === 'denied') { toast('ممنوعة — فعّلها من إعدادات المتصفح'); return; }
    Notification.requestPermission().then(() => { renderAccount(); toast('تم ✔'); }).catch(() => {});
  });

  // التثبيت
  $('#btnInstall').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) { /* */ }
    deferredPrompt = null;
    $('#installBanner').classList.add('hidden');
  });
  $('#btnInstallClose').addEventListener('click', () => {
    $('#installBanner').classList.add('hidden');
    sessionStorage.setItem('dhimmati.banner', '1');
  });

  // الإعدادات
  $('#currencySel').addEventListener('change', (e) => {
    S.currency = e.target.value;
    save();
    render();
    toast('انغيّرت العملة ✔');
  });
  $('#myName').addEventListener('input', (e) => {
    S.myName = e.target.value.trim();
    save();
  });
  $('#btnAddCat').addEventListener('click', () => {
    const v = $('#newCatName').value.trim();
    if (!v) { toast('اكتب اسم التصنيف'); return; }
    if (!S.cats.includes(v)) S.cats.push(v);
    $('#newCatName').value = '';
    save();
    renderCatManage();
    renderCatFilter();
    toast('انضاف التصنيف ✔');
  });
  $('#btnExport').addEventListener('click', exportData);
  $('#btnImport').addEventListener('click', () => $('#fileImport').click());
  $('#fileImport').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });
  $('#btnSample').addEventListener('click', async () => {
    if (S.people.length) {
      const ok = await confirmBox('في أشخاص موجودين — نضيف 3 نماذج زيادة؟', 'إضافة');
      if (!ok) return;
    }
    addSample();
  });
  $('#btnClear').addEventListener('click', async () => {
    const ok = await confirmBox('راح تروح كل البيانات محليًا. نسخة احتياطية؟', 'تفريغ');
    if (!ok) return;
    const keepCur = S.currency, keepTheme = S.theme, keepName = S.myName;
    S = defaults();
    S.currency = keepCur;
    S.theme = keepTheme;
    S.myName = keepName;
    save();
    render();
    toast('انفرغ الدفتر');
  });

  // الخلفية
  $('#backdrop').addEventListener('click', closeTop);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#modalConfirm').hidden) return;
      closeTop();
    }
  });

  window.addEventListener('online', () => {
    if (sess && (syncState === 'error' || syncQueued)) runSync();
  });
}

/* ─── الإقلاع ─── */
async function init() {
  const cs = $('#currencySel');
  cs.innerHTML = Object.entries(CUR)
    .map(([k, v]) => `<option value="${k}">${v.label} (${v.sym})</option>`)
    .join('');
  applyTheme();
  syncSettingsUI();
  wire();
  wireInstall();
  render();
  renderCatManage();
  renderAccount();
  handleInvite();
  scheduleDueChecks();

  // استرجاع سحابي عند وجود جلسة وبيانات محلية فاضية
  if (sess) {
    if (S.people.length === 0) {
      try {
        const remote = await pullRemote();
        if (remote && Array.isArray(remote.people) && remote.people.length) {
          S = Object.assign(defaults(), remote);
          save(false);
          applyTheme(); syncSettingsUI(); render(); renderCatManage();
          toast(`رجّعنا ${S.people.length} شخص من السحابة ✔`);
        } else {
          scheduleSync();
        }
        lastSyncAt = Date.now();
        syncState = 'ok';
      } catch (e) {
        syncState = 'error';
        syncErr = e.message || '';
      }
      renderAccount();
    } else {
      scheduleSync();
    }
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
