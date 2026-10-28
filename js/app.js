'use strict';
/* ═══════════ ذِمّتي — دفتر الديون الذكي (v1.1.0) ═══════════
   كل البيانات محلية (localStorage) — بدون سيرفر، بدون تتبع. */

/* ─── ثوابت ─── */
const KEY = 'dhimmati.v1';

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
  return { v: 1, currency: 'ILS', theme: 'auto', myName: '', people: [], log: [] };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.people) && Array.isArray(d.log)) {
        d.people.forEach((p) => { if (typeof p.bal !== 'number') p.bal = 0; });
        if (typeof d.myName !== 'string') d.myName = '';
        return d;
      }
    }
  } catch (e) { /* بيانات تالفة — نبدأ من جديد */ }
  return defaults();
}

let S = load();
let curFilter = 'all';
let editingId = null;
let currentPid = null;
let formDir = 'credit';
let payMode = 'pay';
let payDir = 'credit';
let shareCtx = { type: 'app' };
let sheetStack = [];
let pendingInvite = null;
let deferredPrompt = null;

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('تعذّر الحفظ — مساحة المتصفح ممتلئة'); }
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

/* ─── العرض ─── */
function rowHTML(p) {
  const initial = esc((p.name || '?').trim().charAt(0) || '?');
  const cls = balClass(p.bal);
  const sub = [p.note, balDir(p.bal)].filter(Boolean).join(' · ');
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

  const sorted = sortPeople(S.people);
  const recent = sorted.slice(0, 5);
  $('#homeList').innerHTML = recent.map(rowHTML).join('');
  $('#homeList').classList.toggle('hidden', recent.length === 0);
  $('#homeEmpty').classList.toggle('hidden', recent.length !== 0);

  renderPeopleView();
}

function renderPeopleView() {
  const q = ($('#search').value || '').trim();
  let arr = sortPeople(S.people);
  if (q) arr = arr.filter((p) => p.name.includes(q));
  if (curFilter === 'credit') arr = arr.filter((p) => p.bal > 0);
  if (curFilter === 'debit') arr = arr.filter((p) => p.bal < 0);
  if (curFilter === 'settled') arr = arr.filter((p) => p.bal === 0);

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

function closeAllSheets() {
  while (sheetStack.length) {
    const el = sheetStack.pop();
    el.classList.remove('open');
    setTimeout(() => { el.hidden = true; }, 300);
  }
  $('#backdrop').classList.remove('show');
  document.body.classList.remove('no-scroll');
  setTimeout(() => { if (!sheetStack.length) $('#backdrop').hidden = true; }, 300);
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  $('#toasts').appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 350);
  }, 2500);
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
function addPerson({ name, dir, amount, note }) {
  const p = {
    id: uid(),
    name: name.trim(),
    note: (note || '').trim(),
    created: Date.now(),
    bal: dir === 'credit' ? amount : -amount
  };
  S.people.push(p);
  S.log.push({ id: uid(), pid: p.id, kind: 'add', amount, dir, date: Date.now() });
  save();
  render();
  return p;
}

function applyPay(pid, amount) {
  const p = findP(pid);
  if (!p) return;
  const before = p.bal;
  const applied = Math.min(Math.abs(before), amount);
  if (applied <= 0) return;
  p.bal = before > 0 ? r2(before - applied) : r2(before + applied);
  S.log.push({ id: uid(), pid, kind: 'pay', amount: applied, date: Date.now() });
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
  S.people = S.people.filter((p) => p.id !== pid);
  S.log = S.log.filter((e) => e.pid !== pid);
  save();
  render();
}

/* ─── نموذج الشخص ─── */
function openPersonForm(p = null) {
  editingId = p ? p.id : null;
  formDir = p ? (p.bal >= 0 ? 'credit' : 'debit') : 'credit';
  $('#personFormTitle').textContent = p ? 'تعديل الشخص' : 'إضافة شخص';
  $('#pName').value = p ? p.name : '';
  $('#pNote').value = p ? p.note || '' : '';
  $('#pAmount').value = '';
  $('#amountField').hidden = !!p;
  $('#amountField2').hidden = !!p;
  $$('#pDir .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.dir === formDir));
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
  const logs = S.log.filter((e) => e.pid === p.id).sort((a, b) => b.date - a.date).slice(0, 30);

  const logHTML = logs.length
    ? logs.map((e) => {
        let label = '', val = '', lc = '';
        if (e.kind === 'add') {
          label = e.dir === 'credit' ? 'دين جديد (ليّا عليه)' : 'دين جديد (أنا عليه)';
          val = (e.dir === 'credit' ? '+' : '−') + fmt(e.amount);
          lc = e.dir === 'credit' ? 'l-pos' : 'l-neg';
        } else if (e.kind === 'pay') {
          label = 'دفعة';
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
      ${p.note ? `<div class="d-note">${esc(p.note)}</div>` : ''}
      <div class="d-amount ${cls}">${p.bal === 0 ? 'مسدّد بالكامل ✔' : fmt(p.bal) + ' — ' + balDir(p.bal)}</div>
    </div>
    <div class="d-actions">
      <button type="button" class="d-act primary" data-act="pay" ${p.bal === 0 ? 'disabled style="opacity:.45"' : ''}><i>💸</i>دفعة</button>
      <button type="button" class="d-act primary" data-act="debt"><i>➕</i>دين جديد</button>
      <button type="button" class="d-act" data-act="share"><i>📤</i>مشاركة/طلب</button>
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
  if (mode === 'pay') {
    $('#payTitle').textContent = 'تسجيل دفعة';
    $('#payRemain').textContent = 'المتبقي: ' + fmt(p.bal);
    $('#payDirField').hidden = true;
  } else {
    $('#payTitle').textContent = 'دين جديد';
    $('#payDirField').hidden = p.bal !== 0;
    if (p.bal === 0) {
      payDir = 'credit';
      $$('#payDir .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.dir === payDir));
    }
    $('#payRemain').textContent = 'الرصيد الحالي: ' + fmt(p.bal);
  }
  openSheet($('#sheetPay'));
  setTimeout(() => $('#payAmount').focus(), 350);
}

/* ─── المشاركة ─── */
function appURL() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

/* رابط طلب موجّه: يفتح عند الطرف الآخر باسمه ومبلغه — قلب حلقة الانتشار */
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
  return `بدك دفتر ذكي للي عليك واللي ليك؟ «ذِمّتي» بيسجّل الديون، بيفكّرك، وببلمسة بتوصل لواتساب — عربي بالكامل ومن غير تسجيل 👉 ${appURL()}`;
}

function shareTextPerson(p) {
  const amt = fmt(Math.abs(p.bal));
  const url = p.bal !== 0 ? inviteURL(p) : appURL();
  if (p.bal > 0) {
    return `يا ${p.name}، تذكير لطيف: بذمتك عندي ${amt} 😊 والطلب مسجّل برابط — افتحه وسجّله بدقائق 👉 ${url}${signOff()}`;
  }
  if (p.bal < 0) {
    return `يا ${p.name}، بذمّتي عليك ${amt} 💸 ولسا بدي أسدّدلك — فتح الرابط بينزّل المبلغ بدفترك على طول 👉 ${url}${signOff()}`;
  }
  return `يا ${p.name}، حساباتنا خلصت وتسديدنا تمام ✔ يلا سجّل أنت كمان بـ«ذِمّتي» 👉 ${url}${signOff()}`;
}

function shareTextSummary() {
  const t = totals();
  const top = sortPeople(S.people).find((p) => p.bal > 0);
  return `ملخّص دفترك بـ«ذِمّتي»: مستحق ليّا ${fmt(t.credit)} · مستحق منّي ${fmt(t.debt)} · الصافي ${fmt(t.net)}${top ? ` · وأكبر مدين: ${top.name}` : ''} — نظّم ذمّك وبذمّتك بدون تسجيل 👉 ${appURL()}${signOff()}`;
}

function currentShareText() {
  if (shareCtx.type === 'person') {
    const p = findP(shareCtx.pid);
    if (p) return shareTextPerson(p);
  }
  if (shareCtx.type === 'summary') return shareTextSummary();
  return shareTextApp();
}

function openShare(ctx) {
  shareCtx = ctx;
  const isPerson = ctx.type === 'person';
  const p = isPerson ? findP(ctx.pid) : null;
  if (ctx.type === 'summary') $('#shareTitle').textContent = 'ملخّص ذمّتي';
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
    x.fillText('ملخّص ذمّتي', W / 2, 360);

    const rows = [
      ['مستحق ليّا', fmt(t.credit), '#B9FFDD'],
      ['مستحق منّي', fmt(t.debt), '#FFC9D4'],
      ['الصافي', fmt(t.net), '#FFFFFF']
    ];
    rows.forEach((r, i) => {
      const y = 452 + i * 96;
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
    x.fillText(
      top ? `وأكبر مدين: ${top.name}` : `${S.people.length} شخص بدفترك`,
      W / 2, 738
    );
    drawFooter(x, W, H);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }

  if (p) {
    const cls = balClass(p.bal);
    const label = p.bal > 0 ? 'تذكير لطيف بالذمة' : p.bal < 0 ? 'ذمّتي عليك' : 'تسديد كامل — برافو!';
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
    x.fillText(balDir(p.bal), W / 2, 718);
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
    x.fillText('عربي · بدون تسجيل · بياناتك عندك', W / 2, 700);
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
      catch (e) { /* ألغى المستخدم */ }
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

/* ─── رابط الطلب الموجّه: الاستقبال ─── */
function cleanURL() {
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* file:// */ }
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
  const recDir = origDir === 'credit' ? 'debit' : 'credit'; // المعكوس لطرف الآخر
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
    { name: 'سامي', note: 'قرض العرس', dir: 'credit', amount: 750, d: 6 },
    { name: 'عمّي بشار', note: 'سلفة', dir: 'debit', amount: 300, d: 4 },
    { name: 'محمود', note: 'نص تلفون', dir: 'credit', amount: 450, d: 2 }
  ];
  rows.forEach((r) => {
    const p = { id: uid(), name: r.name, note: r.note, created: now - r.d * 864e5, bal: r.dir === 'credit' ? r.amount : -r.amount };
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

  // فتح أي شخص من أي قائمة
  document.addEventListener('click', (e) => {
    const li = e.target.closest('.li[data-id]');
    if (li) openDetail(li.dataset.id);
    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) closeTop();
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
    b.addEventListener('click', () => { S.theme = b.dataset.tv; save(); applyTheme(); }));

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

    if (editingId) {
      const p = findP(editingId);
      if (p) { p.name = name; p.note = $('#pNote').value.trim(); save(); render(); }
      closeTop();
      if (sheetStack.includes($('#sheetDetail'))) renderDetail();
      toast('انحفظ ✔');
      return;
    }

    const amount = parseAmt($('#pAmount').value);
    if (!amount) { toast('اكتب مبلغًا صحيحًا'); $('#pAmount').focus(); return; }
    addPerson({ name, dir: formDir, amount, note: $('#pNote').value });
    closeTop();
    toast('انضاف ✔');
  });

  // تفاصيل — أزرار
  $('#detailBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const p = findP(currentPid);
    if (!p) return;

    if (act === 'pay') openPaySheet('pay');
    else if (act === 'debt') openPaySheet('debt');
    else if (act === 'share') openShare({ type: 'person', pid: p.id });
    else if (act === 'edit') openPersonForm(p);
    else if (act === 'settle') {
      const ok = await confirmBox(`تسديد كامل بمبلغ ${fmt(Math.abs(p.bal))}؟`, 'تسديد');
      if (ok) { settle(p.id); renderDetail(); toast('تسدّد بالكامل 🎉'); }
    } else if (act === 'del') {
      const ok = await confirmBox(`حذف «${p.name}» وسجله نهائيًا؟`, 'حذف');
      if (ok) { deletePerson(p.id); closeTop(); toast('انحذف'); }
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

    if (payMode === 'pay') {
      if (amount > Math.abs(p.bal)) { toast('المبلغ أكبر من الرصيد — استخدم «تسديد كامل»'); return; }
      applyPay(p.id, amount);
      toast('سُجّلت الدفعة ✔');
    } else {
      const dir = p.bal !== 0 ? (p.bal > 0 ? 'credit' : 'debit') : payDir;
      applyDebt(p.id, amount, dir);
      toast('انضاف الدين ✔');
    }
    closeTop();
    renderDetail();
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
    catch (e) { /* ألغى المستخدم */ }
  });

  // رابط الطلب الموجّه — الاستقبال
  $('#btnInviteAccept').addEventListener('click', acceptInvite);
  $('#btnInviteLater').addEventListener('click', () => {
    pendingInvite = null;
    closeTop();
    toast('تمام — الدفتر مفتوح قدامك');
  });

  // تثبيت التطبيق
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
    const ok = await confirmBox('راح تروح كل البيانات نهائيًا. نسخة احتياطية؟', 'تفريغ');
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
}

/* ─── الإقلاع ─── */
function init() {
  const cs = $('#currencySel');
  cs.innerHTML = Object.entries(CUR)
    .map(([k, v]) => `<option value="${k}">${v.label} (${v.sym})</option>`)
    .join('');
  applyTheme();
  syncSettingsUI();
  wire();
  wireInstall();
  render();
  handleInvite();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
