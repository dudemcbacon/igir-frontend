const PAGE_SIZE = 100;
const FLAG_COLUMNS = [
  'Retail Release', 'BIOS', 'Unlicensed', 'Patched', 'Demo', 'Beta', 'Prototype',
  'Sample', 'Debug', 'Program', 'Aftermarket', 'Homebrew', 'Bad',
];
const STATUS_META = {
  FOUND: { label: 'Found', icon: '✓', cls: 'found', order: 0 },
  MISSING: { label: 'Missing', icon: '✕', cls: 'missing', order: 1 },
  DUPLICATE: { label: 'Duplicate', icon: '!', cls: 'duplicate', order: 2 },
  UNUSED: { label: 'Unused', icon: '–', cls: 'unused', order: 3 },
};

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat();
const pctFmt = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });

const state = {
  header: [],
  rows: [],
  dats: [],
  filtered: [],
  page: 0,
  sort: { key: 'status', dir: 1 },
  expanded: new Set(),
};

// RFC 4180 CSV parser: quoted fields, escaped quotes, embedded commas/newlines.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

const basename = (p) => p.split(/[\\/]/).pop();

function buildModel(table) {
  const [header, ...records] = table;
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  const rows = records.map((r, id) => {
    const files = r[col['ROM Files']] ? r[col['ROM Files']].split('|') : [];
    const name = r[col['Game Name']] || (files[0] ? basename(files[0]) : '(unnamed)');
    const dat = r[col['DAT Name']] || '';
    return {
      id,
      raw: r,
      dat,
      name,
      status: r[col['Status']],
      files,
      flags: FLAG_COLUMNS.filter((f) => r[col[f]] === 'true'),
      haystack: `${name}\n${files.join('\n')}`.toLowerCase(),
    };
  });

  const byDat = new Map();
  for (const row of rows) {
    if (!row.dat || (row.status !== 'FOUND' && row.status !== 'MISSING')) continue;
    const d = byDat.get(row.dat) ?? { name: row.dat, found: 0, missing: 0 };
    row.status === 'FOUND' ? d.found++ : d.missing++;
    byDat.set(row.dat, d);
  }
  const dats = [...byDat.values()].map((d) => ({ ...d, total: d.found + d.missing, pct: d.found / (d.found + d.missing) }));
  return { header, rows, dats };
}

// ---------- Summary ----------

function renderSummary() {
  const counts = { FOUND: 0, MISSING: 0, DUPLICATE: 0, UNUSED: 0 };
  for (const r of state.rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const pct = counts.FOUND / (counts.FOUND + counts.MISSING || 1);
  $('hero-value').textContent = pctFmt.format(pct);
  $('hero-dats').textContent = fmt.format(state.dats.length);
  $('hero-meter').firstElementChild.style.width = `${pct * 100}%`;
  $('tile-found').textContent = fmt.format(counts.FOUND);
  $('tile-missing').textContent = fmt.format(counts.MISSING);
  $('tile-duplicate').textContent = fmt.format(counts.DUPLICATE);
  $('tile-unused').textContent = fmt.format(counts.UNUSED);
  syncTiles();
}

function syncTiles() {
  const status = $('status-filter').value;
  for (const tile of document.querySelectorAll('.tile')) {
    tile.setAttribute('aria-pressed', String(tile.dataset.status === status));
  }
}

// ---------- DAT list ----------

const DAT_SORTS = {
  'pct-desc': (a, b) => b.pct - a.pct || b.total - a.total,
  'pct-asc': (a, b) => a.pct - b.pct || b.total - a.total,
  'missing-desc': (a, b) => b.missing - a.missing,
  'total-desc': (a, b) => b.total - a.total,
  name: (a, b) => a.name.localeCompare(b.name),
};

function renderDats() {
  const q = $('dat-search').value.trim().toLowerCase();
  const selected = $('dat-filter').value;
  const list = state.dats
    .filter((d) => !q || d.name.toLowerCase().includes(q))
    .sort(DAT_SORTS[$('dat-sort').value]);

  const container = $('dat-list');
  container.replaceChildren(...list.map((d) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'dat-row';
    row.setAttribute('role', 'listitem');
    row.setAttribute('aria-pressed', String(d.name === selected));
    row.dataset.dat = d.name;
    row.innerHTML = `
      <span class="dat-name"></span>
      <span class="dat-pct">${fmt.format(d.found)} / ${fmt.format(d.total)} · ${pctFmt.format(d.pct)}</span>
      <span class="meter"><span class="meter-fill" style="display:block;width:${d.pct * 100}%"></span></span>`;
    row.querySelector('.dat-name').textContent = d.name;
    return row;
  }));
  if (!list.length) container.innerHTML = '<p class="muted">No DATs match.</p>';
}

function datTooltip(name) {
  const d = state.dats.find((x) => x.name === name);
  if (!d) return '';
  const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `
    <div class="tt-title">${esc(d.name)}</div>
    <div class="tt-row"><span class="status-dot found"></span>Found<b>${fmt.format(d.found)}</b></div>
    <div class="tt-row"><span class="status-dot missing"></span>Missing<b>${fmt.format(d.missing)}</b></div>
    <div class="tt-row">Complete<b>${pctFmt.format(d.pct)}</b></div>`;
}

// ---------- Games table ----------

const ROW_SORTS = {
  status: (a, b) => STATUS_META[a.status].order - STATUS_META[b.status].order || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name),
  dat: (a, b) => a.dat.localeCompare(b.dat) || a.name.localeCompare(b.name),
  files: (a, b) => a.files.length - b.files.length,
};

function applyFilters() {
  const q = $('game-search').value.trim().toLowerCase();
  const status = $('status-filter').value;
  const dat = $('dat-filter').value;
  const flag = $('flag-filter').value;
  const { key, dir } = state.sort;
  state.filtered = state.rows
    .filter((r) => (!status || r.status === status)
      && (!dat || r.dat === dat)
      && (!flag || r.flags.includes(flag))
      && (!q || r.haystack.includes(q)))
    .sort((a, b) => dir * ROW_SORTS[key](a, b));
  state.page = 0;
  state.expanded.clear();
  syncTiles();
  renderDats();
  renderRows();
}

function renderRows() {
  const total = state.filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  state.page = Math.min(state.page, pages - 1);
  const start = state.page * PAGE_SIZE;
  const slice = state.filtered.slice(start, start + PAGE_SIZE);

  $('result-count').textContent = `${fmt.format(total)} of ${fmt.format(state.rows.length)} rows`;
  $('page-info').textContent = `Page ${state.page + 1} of ${fmt.format(pages)}`;
  $('prev-page').disabled = state.page === 0;
  $('next-page').disabled = state.page >= pages - 1;

  for (const th of document.querySelectorAll('th[data-sort]')) {
    const active = th.dataset.sort === state.sort.key;
    th.querySelector('.arrow')?.remove();
    th.setAttribute('aria-sort', active ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
    if (active) th.insertAdjacentHTML('beforeend', ` <span class="arrow">${state.sort.dir > 0 ? '▲' : '▼'}</span>`);
  }

  const tbody = $('game-rows');
  if (!slice.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No rows match these filters.</td></tr>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const r of slice) {
    const meta = STATUS_META[r.status];
    const tr = document.createElement('tr');
    tr.className = 'game';
    tr.dataset.id = r.id;
    tr.innerHTML = `
      <td><span class="status"><span class="status-icon ${meta.cls}" aria-hidden="true">${meta.icon}</span>${meta.label}</span></td>
      <td class="name-cell"></td>
      <td class="dat-cell"></td>
      <td>${r.flags.map((f) => `<span class="flag">${f}</span>`).join('')}</td>
      <td class="num">${r.files.length || '—'}</td>`;
    tr.querySelector('.name-cell').textContent = r.name;
    tr.querySelector('.dat-cell').textContent = r.dat || '—';
    tr.querySelector('.dat-cell').title = r.dat;
    frag.append(tr);

    if (state.expanded.has(r.id) && r.files.length) {
      const filesRow = document.createElement('tr');
      filesRow.className = 'files';
      const td = document.createElement('td');
      td.colSpan = 5;
      const ul = document.createElement('ul');
      ul.className = 'file-list';
      for (const f of r.files) {
        const li = document.createElement('li');
        li.textContent = f;
        ul.append(li);
      }
      td.append(ul);
      filesRow.append(td);
      frag.append(filesRow);
    }
  }
  tbody.replaceChildren(frag);
}

function exportCsv() {
  const quote = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [state.header, ...state.filtered.map((r) => r.raw)].map((r) => r.map(quote).join(','));
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `igir-report-filtered.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- Loading ----------

async function loadReport(file) {
  $('loading').hidden = false;
  $('loading').textContent = `Loading ${file}…`;
  const text = await (await fetch(`/reports/${encodeURIComponent(file)}`)).text();
  Object.assign(state, buildModel(parseCsv(text)));

  const datFilter = $('dat-filter');
  datFilter.replaceChildren(new Option('All DATs', ''), ...state.dats
    .map((d) => d.name).sort((a, b) => a.localeCompare(b)).map((n) => new Option(n, n)));
  const flagFilter = $('flag-filter');
  flagFilter.replaceChildren(new Option('All types', ''), ...FLAG_COLUMNS
    .filter((f) => state.rows.some((r) => r.flags.includes(f))).map((f) => new Option(f, f)));

  renderSummary();
  applyFilters();
  $('loading').hidden = true;
  for (const id of ['summary', 'dats', 'games']) $(id).hidden = false;
}

async function init() {
  const reports = await (await fetch('/api/reports')).json();
  if (!Array.isArray(reports) || !reports.length) {
    $('loading').textContent = 'No CSV reports found in the reports directory.';
    return;
  }
  const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  $('report-select').replaceChildren(...reports.map((r) => new Option(`${dateFmt.format(r.time)} — ${r.file}`, r.file)));
  await loadReport(reports[0].file);
}

// ---------- Events ----------

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

$('report-select').addEventListener('change', (e) => loadReport(e.target.value));
$('game-search').addEventListener('input', debounce(applyFilters, 150));
for (const id of ['status-filter', 'dat-filter', 'flag-filter']) $(id).addEventListener('change', applyFilters);
$('dat-search').addEventListener('input', renderDats);
$('dat-sort').addEventListener('change', renderDats);
$('export').addEventListener('click', exportCsv);
$('clear-filters').addEventListener('click', () => {
  for (const id of ['game-search', 'status-filter', 'dat-filter', 'flag-filter']) $(id).value = '';
  applyFilters();
});

for (const tile of document.querySelectorAll('.tile')) {
  tile.addEventListener('click', () => {
    const s = $('status-filter');
    s.value = s.value === tile.dataset.status ? '' : tile.dataset.status;
    applyFilters();
    $('games').scrollIntoView({ behavior: 'smooth' });
  });
}

$('dat-list').addEventListener('click', (e) => {
  const row = e.target.closest('.dat-row');
  if (!row) return;
  const f = $('dat-filter');
  f.value = f.value === row.dataset.dat ? '' : row.dataset.dat;
  applyFilters();
});

const tooltip = $('tooltip');
$('dat-list').addEventListener('mousemove', (e) => {
  const row = e.target.closest('.dat-row');
  if (!row) { tooltip.hidden = true; return; }
  if (tooltip.dataset.dat !== row.dataset.dat) {
    tooltip.dataset.dat = row.dataset.dat;
    tooltip.innerHTML = datTooltip(row.dataset.dat);
  }
  tooltip.hidden = false;
  const { width, height } = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.min(e.clientX + 14, innerWidth - width - 8)}px`;
  tooltip.style.top = `${Math.min(e.clientY + 14, innerHeight - height - 8)}px`;
});
$('dat-list').addEventListener('mouseleave', () => { tooltip.hidden = true; });

$('game-rows').addEventListener('click', (e) => {
  const tr = e.target.closest('tr.game');
  if (!tr) return;
  const id = Number(tr.dataset.id);
  state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
  renderRows();
});

for (const th of document.querySelectorAll('th[data-sort]')) {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : 1 };
    applyFilters();
  });
}

$('prev-page').addEventListener('click', () => { state.page--; renderRows(); $('games').scrollIntoView(); });
$('next-page').addEventListener('click', () => { state.page++; renderRows(); $('games').scrollIntoView(); });

$('theme-toggle').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  localStorage.setItem('theme', root.dataset.theme);
});
if (localStorage.getItem('theme')) document.documentElement.dataset.theme = localStorage.getItem('theme');

init().catch((err) => { $('loading').textContent = `Failed to load: ${err.message}`; });
