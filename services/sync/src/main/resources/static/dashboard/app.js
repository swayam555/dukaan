'use strict';
// Owner dashboard. No framework, no third-party scripts: one fetch per view against /v1/dashboard/summary.
const $ = (id) => document.getElementById(id);
const KEY = 'dukaan.dashboard';
let session = null;
try { session = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { session = null; }
let days = 7;
let phone = '';

const inr = (paise, digits = 0) => (paise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: digits, minimumFractionDigits: digits });
const qty = (milli) => (milli / 1000).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}), ...opts.headers } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && session) { signOut(); throw new Error('Your session ended. Sign in again.'); }
  if (!res.ok) throw new Error(body.message || (res.status === 429 ? 'Too many tries. Wait a minute.' : `Request failed (${res.status})`));
  return body;
}

function show(view) {
  $('login').hidden = view !== 'login';
  $('dash').hidden = view !== 'dash';
  $('logout').hidden = view !== 'dash';
}

function signOut() {
  session = null;
  try { sessionStorage.removeItem(KEY); } catch { /* storage off */ }
  $('shop-name').textContent = '';
  $('otp-form').hidden = true; $('phone-form').hidden = false;
  show('login');
}

$('phone-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true; $('login-error').textContent = '';
  try {
    phone = $('phone').value.replace(/\D/g, '');
    const r = await api('/v1/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone }) });
    $('phone-form').hidden = true; $('otp-form').hidden = false; $('otp').focus();
    $('dev-otp').textContent = r.devOtp ? `Dev server: OTP is ${r.devOtp}` : '';
  } catch (err) { $('login-error').textContent = err.message; } finally { btn.disabled = false; }
});

$('otp-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true; $('login-error').textContent = '';
  try {
    const r = await api('/v1/auth/dashboard', { method: 'POST', body: JSON.stringify({ phone, otp: $('otp').value.trim() }) });
    session = { token: r.token, shopName: r.shopName };
    try { sessionStorage.setItem(KEY, JSON.stringify(session)); } catch { /* storage off: session lasts this tab */ }
    $('dev-otp').textContent = ''; $('otp').value = '';
    await load();
  } catch (err) { $('login-error').textContent = err.message; } finally { btn.disabled = false; }
});

$('logout').addEventListener('click', signOut);
document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
  days = Number(b.dataset.days);
  document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  load();
}));

function chart(series) {
  const box = $('chart'); box.replaceChildren();
  const W = 720, H = 220, L = 56, B = 24, T = 8;
  const max = Math.max(1, ...series.map((d) => d.totalPaise));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none');
  const mk = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text) n.textContent = text; svg.append(n); return n; };
  for (const f of [0, 0.5, 1]) {
    const y = T + (H - B - T) * (1 - f);
    mk('line', { x1: L, x2: W, y1: y, y2: y });
    mk('text', { x: L - 6, y: y + 4, 'text-anchor': 'end' }, inr(max * f));
  }
  const slot = (W - L) / series.length, bw = Math.max(2, slot * 0.7);
  const every = Math.ceil(series.length / 10);
  series.forEach((d, i) => {
    const h = (H - B - T) * (d.totalPaise / max);
    const r = mk('rect', { class: 'bar-rect', x: L + i * slot + (slot - bw) / 2, y: H - B - h, width: bw, height: Math.max(h, d.totalPaise ? 1 : 0), rx: 2 });
    const t = document.createElementNS(ns, 'title'); t.textContent = `${d.day}: ${inr(d.totalPaise, 2)} · ${d.bills} bills`; r.append(t);
    if (i % every === 0) mk('text', { x: L + i * slot + slot / 2, y: H - 6, 'text-anchor': 'middle' }, new Date(`${d.day}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
  });
  box.setAttribute('aria-label', `Sales by day, ${series.length} days, highest ${inr(max)}`);
  box.append(svg);
}

function rows(tableId, list, cells, empty) {
  const tb = document.querySelector(`#${tableId} tbody`); tb.replaceChildren();
  if (!list.length) { const tr = el('tr'); const td = el('td', empty, 'empty'); td.colSpan = 4; tr.append(td); tb.append(tr); return; }
  for (const item of list) { const tr = el('tr'); for (const c of cells(item)) tr.append(c); tb.append(tr); }
}

const ago = (iso) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

async function load() {
  if (!session) return show('login');
  show('dash');
  $('shop-name').textContent = `· ${session.shopName}`;
  try {
    const s = await api(`/v1/dashboard/summary?days=${days}`);
    $('k-sales').textContent = inr(s.totalPaise);
    $('k-bills').textContent = `${s.bills.toLocaleString('en-IN')} bills${s.bills ? ` · avg ${inr(Math.round(s.totalPaise / s.bills))}` : ''}`;
    $('k-profit').textContent = inr(s.profitPaise);
    $('k-tax').textContent = inr(s.taxPaise);
    $('k-voids').textContent = s.voids ? `${s.voids} bill${s.voids > 1 ? 's' : ''} voided` : 'no voids';
    $('k-due').textContent = inr(s.toCollectPaise);
    $('k-due-n').textContent = `${s.customersWithDues} customer${s.customersWithDues === 1 ? '' : 's'}`;
    const lag = s.lastServerSeq - s.projectedSeq;
    $('fresh').textContent = lag > 0 ? `Catching up: ${lag} change${lag > 1 ? 's' : ''} still being counted` : `Up to date · ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
    chart(s.days);
    rows('t-items', s.topItems, (i) => [el('td', i.name), el('td', qty(i.qtyMilli), 'num'), el('td', inr(i.totalPaise), 'num')], 'No sales in this period.');
    rows('t-dues', s.topDues, (d) => [el('td', d.name), el('td', inr(d.balancePaise), 'num')], 'Nobody owes you money.');
    rows('t-devices', s.devices, (d) => {
      const role = el('td'); role.append(el('span', d.revoked ? 'removed' : d.role, d.revoked ? 'pill off' : 'pill'));
      return [el('td', d.name), el('td', d.prefix), role, el('td', ago(d.lastSeen))];
    }, 'No phones yet.');
  } catch (err) {
    $('fresh').textContent = err.message;
  }
}

load();
