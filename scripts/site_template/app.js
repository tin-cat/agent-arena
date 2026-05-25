/* ═══════════════════════════════════════════════════════════════════════════
   AgentArena dashboard — terminal-themed SPA
   ═══════════════════════════════════════════════════════════════════════════ */

// DATA is provided by /boot.js (loaded before this script). It's the same
// payload that used to be inlined as <script id="bootData"> — moved out so it
// can be cached separately across the now-many per-route HTML files.
const DATA = window.DATA || {};
const RATING_COLOR = DATA.rating_color || {
  excellent: '#34d399', good: '#7dd3fc', partial: '#fbbf24', failed: '#f87171',
};
const RATING_SCORE = DATA.rating_score || { excellent: 1, good: 0.75, partial: 0.4, failed: 0 };
const FONT = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

Chart.defaults.font.family = FONT;
Chart.defaults.font.size = 10.5;
Chart.defaults.color = '#8a96a8';
Chart.defaults.borderColor = '#1f2a3a';
Chart.defaults.animation = false;

/* ──────────────────────────────── helpers ──────────────────────────────── */
const $ = (sel, root = document) => root.querySelector(sel);
const view = () => $('#view');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoney = (v) => v == null ? '—' : '$' + Number(v).toFixed(2);
const fmtNum   = (v) => v == null ? '—' : new Intl.NumberFormat().format(v);
const fmtPct   = (v) => v == null ? '—' : Math.round(v * 100) + '%';
// Scores are stored/computed on a 0–1 scale (RATING_SCORE), but displayed on a
// friendlier 0–10 scale: 0.93 → "9.3". fmtScore is the compact form for tables,
// bars and badges; fmtScoreDetail adds precision + the "/10" suffix for the
// prominent score stat on detail/profile pages.
const fmtScore       = (v) => v == null ? '—' : (Number(v) * 10).toFixed(1);
const fmtScoreDetail = (v) => v == null ? '—' : (Number(v) * 10).toFixed(2) + '/10';

function fmtDuration(seconds) {
  if (seconds == null) return '—';
  const s = Math.round(seconds);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), rem = s % 60;
  if (m < 60) return `${m}m ${String(rem).padStart(2, '0')}s`;
  const h = Math.floor(m / 60), rm = m % 60;
  return `${h}h ${String(rm).padStart(2, '0')}m`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  return iso.slice(0, 10);
}
function ratingDots(stages, total) {
  total = total ?? (stages?.length ?? 0);
  const parts = [];
  for (let i = 0; i < total; i++) {
    const s = stages && stages[i];
    const color = s ? RATING_COLOR[s.rating] : '#2a3850';
    const title = s ? `${esc(s.id)}: ${esc(s.rating)}` : 'not run';
    parts.push(`<span class="dot" style="background:${color}" title="${title}"></span>`);
  }
  return `<span class="dots">${parts.join('')}</span>`;
}
function bar(score) {
  const pct = Math.round((score ?? 0) * 100);
  return `<div class="bar-row"><div class="bar"><div style="width:${pct}%"></div></div><span class="v">${fmtScore(score)}</span></div>`;
}

// Replace an <img> that failed to load with a same-size span showing the
// entry's initial. The initial is passed via `data-initial` so the inline
// onerror attribute doesn't need to embed user-supplied characters.
window.logoFallback = function (img) {
  const span = document.createElement('span');
  span.className = (img.className || 'catalog-logo') + ' fallback';
  span.textContent = img.dataset.initial || '?';
  img.replaceWith(span);
};

/* ─────────────────────────── chart lifecycle ─────────────────────────── */
const _charts = new Map();
function makeChart(id, cfg) {
  const el = document.getElementById(id);
  if (!el) return;
  destroyChart(id);
  _charts.set(id, new Chart(el, cfg));
}
function destroyChart(id) {
  const c = _charts.get(id);
  if (c) { c.destroy(); _charts.delete(id); }
}
function destroyAllCharts() {
  for (const c of _charts.values()) c.destroy();
  _charts.clear();
}

const COMMON_SCALES = {
  grid: { color: 'rgba(31,42,58,.5)', drawTicks: false },
  ticks: { color: '#8a96a8' },
};
const COMMON_TOOLTIP = {
  backgroundColor: '#0d121b',
  borderColor: '#2a3850', borderWidth: 1,
  titleColor: '#d5dde8', bodyColor: '#8a96a8',
  padding: 10, cornerRadius: 4,
  titleFont: { family: FONT, weight: '600', size: 11 },
  bodyFont:  { family: FONT, size: 11 },
};

/* ════════════════════════════════════════════════════════════════════════
   Lazy-loaded data — sharded JSON, fetched on demand, cached in memory
   ════════════════════════════════════════════════════════════════════════ */
// Bust the browser cache whenever the site is rebuilt — without this, a stale
// JSON shard (e.g. one missing a newly-added field) keeps getting served.
const _BUILD_VER = DATA.build_date || '';
const _jsonCache = new Map();
function loadJSON(path) {
  if (_jsonCache.has(path)) return _jsonCache.get(path);
  const url = _BUILD_VER ? `${path}?v=${encodeURIComponent(_BUILD_VER)}` : path;
  const p = fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Could not load ${path} (HTTP ${r.status})`);
    return r.json();
  }).catch((err) => {
    _jsonCache.delete(path);
    throw err;
  });
  _jsonCache.set(path, p);
  return p;
}
// JSON shard URLs are site-root-absolute (leading "/") so they resolve the
// same way no matter how deep the current route's pathname is.
const loadRuns        = ()         => loadJSON('/runs.json').then((d) => d.runs);
const loadTest        = (name)     => loadJSON(`/tests/${encodeURIComponent(name)}.json`);
const loadRun         = (t, id)    => loadJSON(`/runs/${encodeURIComponent(t)}/${encodeURIComponent(id)}.json`);
const loadContributor = (handle)   => loadJSON(`/contributors/${encodeURIComponent(handle)}.json`);
const loadAgent       = (id)       => loadJSON(`/agents/${encodeURIComponent(id)}.json`);
const loadProvider    = (id)       => loadJSON(`/providers/${encodeURIComponent(id)}.json`);
const loadModel       = (id)       => loadJSON(`/models/${encodeURIComponent(id)}.json`);
const loadStack       = (id)       => loadJSON(`/stacks/${encodeURIComponent(id)}.json`);

const SKELETON = `<div class="panel"><div class="panel-body t-mute">loading…</div></div>`;

function errorPanelHTML(err) {
  const fileScheme = location.protocol === 'file:';
  return `<div class="panel">
    <div class="panel-head"><span class="panel-title alt">error</span></div>
    <div class="panel-body">
      <p>${esc(err.message || String(err))}</p>
      ${fileScheme ? `<p class="t-mute" style="margin-top:14px">Browsers block <code>fetch()</code> from <code>file://</code>. Serve the site locally:</p>
        <pre style="background:var(--bg-2);padding:10px;border-radius:4px;color:var(--cyan);font-size:11.5px;">python3 -m http.server -d site 8000</pre>
        <p class="t-mute">then open <a href="http://localhost:8000">http://localhost:8000</a>.</p>` : ''}
    </div>
  </div>`;
}

/* ════════════════════════════════════════════════════════════════════════
   Router — hash-based, with parameterized routes + async handlers
   ════════════════════════════════════════════════════════════════════════ */
// Route patterns are trailing-slash tolerant so users can paste either form
// in the address bar. Internal links use the trailing-slash form (canonical,
// matches GitHub Pages' directory-index convention).
const routes = [
  { pat: /^\/?$|^\/overview\/?$/,                            name: 'overview',     handler: (_m, gen) => renderOverview(gen) },
  { pat: /^\/leaderboard\/?$/,                               name: 'leaderboard',  handler: (_m, gen) => renderLeaderboard(gen) },
  { pat: /^\/tests\/?$/,                                     name: 'tests',        handler: (_m, gen) => renderTests(null, gen) },
  { pat: /^\/tests\/([^/]+)\/?$/,                            name: 'tests',        handler: (m, gen) => renderTests(m[1], gen) },
  { pat: /^\/tests\/([^/]+)\/runs\/([^/]+)\/?$/,             name: 'runs',         handler: (m, gen) => renderRunDetail(m[1], m[2], 'tests', gen) },
  { pat: /^\/runs\/?$/,                                      name: 'runs',         handler: (_m, gen) => renderRuns(gen) },
  { pat: /^\/runs\/([^/]+)\/([^/]+)\/?$/,                    name: 'runs',         handler: (m, gen) => renderRunDetail(m[1], m[2], 'runs', gen) },
  { pat: /^\/contributors\/?$/,                              name: 'contributors', handler: (_m, gen) => renderContributors(gen) },
  { pat: /^\/contributors\/([^/]+)\/?$/,                     name: 'contributors', handler: (m, gen) => renderContributorProfile(decodeURIComponent(m[1]), gen) },
  { pat: /^\/agents\/?$/,                                    name: 'agents',       handler: (_m, gen) => renderAgents(null, gen) },
  { pat: /^\/agents\/([^/]+)\/?$/,                           name: 'agents',       handler: (m, gen) => renderAgents(decodeURIComponent(m[1]), gen) },
  { pat: /^\/providers\/?$/,                                 name: 'providers',    handler: (_m, gen) => renderProviders(null, gen) },
  { pat: /^\/providers\/([^/]+)\/?$/,                        name: 'providers',    handler: (m, gen) => renderProviders(decodeURIComponent(m[1]), gen) },
  { pat: /^\/models\/?$/,                                    name: 'models',       handler: (_m, gen) => renderModels(null, gen) },
  { pat: /^\/models\/([^/]+)\/?$/,                           name: 'models',       handler: (m, gen) => renderModels(decodeURIComponent(m[1]), gen) },
  { pat: /^\/stacks\/?$/,                                    name: 'stacks',       handler: (_m, gen) => renderStacks(null, gen) },
  { pat: /^\/stacks\/([^/]+)\/?$/,                           name: 'stacks',       handler: (m, gen) => renderStacks(decodeURIComponent(m[1]), gen) },
  { pat: /^\/hardware\/?$/,                                  name: 'hardware',     handler: (_m, gen) => renderHardware(gen) },
  { pat: /^\/contribute\/?$/,                                name: 'contribute',   handler: (_m, gen) => renderContribute(gen) },
];

function parsePath() {
  return location.pathname || '/';
}

// Programmatic navigation — used by onclick handlers on table rows and the
// keyboard shortcuts. Each route URL has its own pre-rendered HTML file, so a
// real navigation is correct: the shell loads, JS re-renders the view from the
// URL.
function navigate(path) {
  location.href = path;
}
window.navigate = navigate;

// Row-level navigation for clickable table rows. Yields to inner links so that
// clicking an <a> inside the row (e.g. a contributor cell) follows that link
// instead of also firing the row's destination — the click delegator above
// handles the link itself.
function rowNav(e, path) {
  if (e.target.closest('a')) return;
  navigate(path);
}
window.rowNav = rowNav;

// Each route() call gets a monotonically-increasing token. Async handlers check
// `currentGen()` before mutating the DOM to avoid stale renders when the user
// navigates again before a fetch resolves.
let _routeGen = 0;
const currentGen = () => _routeGen;
const isStale = (gen) => gen !== _routeGen;

async function route() {
  const gen = ++_routeGen;
  destroyAllCharts();
  const path = parsePath();
  updateRatingScaleVisibility(path);
  $('#main').scrollTop = 0;
  for (const r of routes) {
    const m = path.match(r.pat);
    if (m) {
      highlightNav(r.name);
      try {
        const ret = r.handler(m, gen);
        if (ret && typeof ret.then === 'function') await ret;
      } catch (err) {
        if (isStale(gen)) return;
        console.error(err);
        view().innerHTML = errorPanelHTML(err);
      }
      if (isStale(gen)) return;
      view().classList.remove('fade-in');
      void view().offsetWidth;  // re-trigger animation
      view().classList.add('fade-in');
      return;
    }
  }
  // 404 fallback
  highlightNav('overview');
  view().innerHTML = `<div class="panel"><div class="panel-body"><div class="t-mute">no route ${esc(path)}</div></div></div>`;
}

function highlightNav(name) {
  for (const el of document.querySelectorAll('.nav-item')) {
    el.classList.toggle('active', el.dataset.route === name);
  }
}

/* ════════════════════════════════════════════════════════════════════════
   Views
   ════════════════════════════════════════════════════════════════════════ */

function viewHead(title, tag, lead) {
  return `
    <div class="view-head">
      <h2 class="view-title">${esc(title)} ${tag ? `<span class="view-title-tag">${esc(tag)}</span>` : ''}</h2>
    </div>
    ${lead ? `<p class="view-lead">${lead}</p>` : ''}
  `;
}

/* ──────────────────────────── 01 · OVERVIEW ──────────────────────────── */
function renderOverview() {
  const s = DATA.summary;
  const top = DATA.leaderboard[0];
  const recent = DATA.contributors.recent || [];
  const beasts = DATA.hardware?.headline?.devices || 0;

  view().innerHTML = `
    ${heroHTML()}

    <div class="metric-grid">
      <a class="metric cy" href="/tests/"><div class="label">tests</div><div class="value">${s.tests}</div><div class="sub">community-defined</div></a>
      <a class="metric" href="/runs/"><div class="label">runs</div><div class="value">${s.runs}</div><div class="sub">contributed</div></a>
      ${beasts > 0 ? `
      <a class="metric" href="/hardware/"><div class="label">silicon beasts</div><div class="value">${beasts}</div><div class="sub">self-hosted rigs</div></a>` : ''}
      <a class="metric" href="/models/"><div class="label">models</div><div class="value">${s.models}</div><div class="sub">provider · model combos</div></a>
      <a class="metric alt" href="/contributors/"><div class="label">contributors</div><div class="value">${s.contributors}</div><div class="sub">unique runners</div></a>
    </div>

    <div class="split-2">
      <div class="panel">
        <div class="panel-head"><span class="panel-title">model cost vs quality</span><span class="panel-actions t-mute">size = score · <span style="color:#5ad1ff">cheap</span> → <span style="color:#ff6ad5">expensive</span></span></div>
        <div class="panel-body"><div class="chart-box"><canvas id="scatterChart"></canvas></div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><span class="panel-title alt">runs over time</span><span class="panel-actions t-mute">${DATA.activity.length} days</span></div>
        <div class="panel-body"><div class="chart-box"><canvas id="activityChart"></canvas></div></div>
      </div>
    </div>

    <div class="split-2">
      <div class="panel">
        <div class="panel-head"><span class="panel-title">top of the leaderboard</span><a class="t-cyan" href="/leaderboard/">view all →</a></div>
        <div class="panel-body dense">${overviewLeaderHTML(DATA.leaderboard.slice(0, 5))}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><span class="panel-title">latest contributions</span><a class="t-cyan" href="/contributors/">all contributors →</a></div>
        <div class="panel-body dense"><div class="feed">${recent.slice(0, 6).map(feedItemHTML).join('') || '<div style="padding:14px;color:var(--text-mute)">none yet.</div>'}</div></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><span class="panel-title">contributors leaderboard</span><a class="t-cyan" href="/contributors/">all contributors →</a></div>
      <div class="panel-body dense">${contribCardsHTML((DATA.contributors.profiles || []).slice(0, 5))}</div>
    </div>

    ${top ? `
    <div class="panel">
      <div class="panel-head"><span class="panel-title alt">leader · ${esc(top.agent)} / ${esc(top.model)}</span></div>
      <div class="panel-body">
        <div class="kv-grid">
          <div><span class="k">agent</span><span class="v">${esc(top.agent)}</span></div>
          <div><span class="k">provider</span><span class="v"><span class="pill muted">${esc(top.provider)}</span></span></div>
          <div><span class="k">model</span><span class="v">${esc(top.model)}</span></div>
          <div><span class="k">avg score</span><span class="v t-cyan">${fmtScore(top.avg_rating_score)}</span></div>
          <div><span class="k">success rate</span><span class="v">${fmtPct(top.success_rate)}</span></div>
          <div><span class="k">runs · stages</span><span class="v">${top.run_count} · ${top.stage_count}</span></div>
          <div><span class="k">avg cost / stage</span><span class="v">${fmtMoney(top.avg_cost_per_stage)}</span></div>
          <div><span class="k">avg time / stage</span><span class="v">${fmtDuration(top.avg_duration_sec)}</span></div>
        </div>
      </div>
    </div>` : ''}

    <div class="panel">
      <div class="panel-head"><span class="panel-title">looking for serious benchmarks?</span></div>
      <div class="panel-body">
        <div class="note">
          <span class="note-tag">honest about what we are</span>
          AgentArena is a relaxed, community-run benchmark of real, multi-stage tasks contributed by regular people. It aims to be accurate and useful, not a precise, controlled lab study. If you need rigorous, technical benchmarks, check the <a href="https://github.com/philschmid/ai-agent-benchmark-compendium" rel="noopener">AI Agent Benchmark Compendium</a>, a curated list worth your time.
        </div>
      </div>
    </div>
  `;

  mountScatter();
  mountActivity();
}

function heroHTML() {
  const tagline = DATA.tagline || 'Benchmark your AI coding rig against the world';
  return `
    <section class="hero-panel">
      <div class="hero-main">
        <div class="hero-eyebrow">▌ welcome</div>
        <h1 class="hero-title">${esc(tagline)}.</h1>
        <p class="hero-lead">Live rankings for every model, agent, rig, and contributor in the arena so far. Browse the board, drill into runs, peek at the silicon — then add your own to claim a slot.</p>
        <div class="hero-ctas">
          <a class="cta cta-primary" href="/leaderboard/">→ see the leaderboard</a>
          <a class="cta" href="/contribute/">+ contribute your tests</a>
        </div>
      </div>
    </section>
  `;
}

const RATING_SCALE_ROWS = [
  ['excellent', '10.0', 'clean one-shot'],
  ['good',      '7.5',  'minor flaws'],
  ['partial',   '4.0',  'major gaps'],
  ['failed',    '0.0',  'could not complete'],
];
function ratingScaleHTML() {
  return `
    <div class="rating-scale-label">rating scale</div>
    <ul class="legend legend-inline">
      ${RATING_SCALE_ROWS.map(([k, s, blurb]) => `
        <li>
          <span class="dot" style="background:${RATING_COLOR[k]}"></span>
          <span class="lg-label">${k}</span>
          <span class="lg-score">${s}</span>
          <span class="lg-blurb">${blurb}</span>
        </li>`).join('')}
    </ul>
  `;
}
function mountRatingScale() {
  const el = $('#ratingScale');
  if (el && !el.dataset.mounted) {
    el.innerHTML = ratingScaleHTML();
    el.dataset.mounted = '1';
  }
}

// Routes that aggregate enough leaderboard-style context to not need the
// rating-scale legend at the bottom. Detail pages (e.g. /agents/<id>/) are
// excluded — they still show per-run rating dots where the legend is useful.
const RATING_SCALE_HIDDEN_PATHS = [
  /^\/?$/, /^\/overview\/?$/,
  /^\/tests\/?$/,
  /^\/leaderboard\/?$/,
  /^\/contributors\/?$/,
  /^\/hardware\/?$/,
  /^\/agents\/?$/,
  /^\/providers\/?$/,
  /^\/models\/?$/,
  /^\/stacks\/?$/,
  /^\/contribute\/?$/,
];
function updateRatingScaleVisibility(path) {
  const el = $('#ratingScale');
  if (!el) return;
  el.hidden = RATING_SCALE_HIDDEN_PATHS.some((re) => re.test(path));
}

function overviewLeaderHTML(rows) {
  if (!rows.length) return '<div style="padding:14px;color:var(--text-mute)">no runs yet.</div>';
  return `<table>
    <thead><tr><th class="rank">#</th><th>agent</th><th>model</th><th>score</th><th class="num">runs</th></tr></thead>
    <tbody>${rows.map((r, i) => `
      <tr><td class="rank${i === 0 ? ' top' : ''}">${i + 1}</td>
        <td>${esc(r.agent)}</td>
        <td><b>${esc(r.model)}</b> <span class="pill muted">${esc(r.provider)}</span></td>
        <td style="min-width:160px">${bar(r.avg_rating_score)}</td>
        <td class="num">${r.run_count}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function feedItemHTML(c) {
  return `<a class="feed-item" href="/tests/${esc(c.test_name)}/runs/${esc(c.run_id)}/">
    <span class="glyph">▸</span>
    <span>${esc(c.handle)} <span class="who">ran</span> ${esc(c.test_name)} <span class="who">on</span> ${esc(c.agent)}/${esc(c.model)}</span>
    <span class="meta">${esc(c.date)}</span>
  </a>`;
}

/* ─────────────────────────── 02 · LEADERBOARD ─────────────────────────── */
function renderLeaderboard() {
  const rows = DATA.leaderboard;

  view().innerHTML = `
    ${viewHead('leaderboard', '02', 'Aggregated across every contributed stage. Ranked by average rating score on a 0–10 scale (excellent = 10, good = 7.5, partial = 4, failed = 0).')}

    <div class="panel">
      <div class="panel-head">
        <span class="panel-title">top by avg score</span>
        <span class="panel-actions t-mute">${rows.length} agent · provider · model combos</span>
      </div>
      <div class="panel-body"><div class="chart-box tall"><canvas id="leaderBar"></canvas></div></div>
    </div>

    <div class="panel">
      <div class="panel-head"><span class="panel-title">full table</span></div>
      <div class="panel-body dense">${leaderboardTableHTML(rows)}</div>
    </div>
  `;
  mountLeaderBar(rows);
}

function leaderboardTableHTML(rows) {
  if (!rows.length) return '<div style="padding:14px;color:var(--text-mute)">no runs yet.</div>';
  return `<table>
    <thead><tr>
      <th class="rank">#</th><th>agent</th><th>provider</th><th>model</th>
      <th>score</th><th class="num">success</th><th class="num">runs</th><th class="num">stages</th>
      <th class="num">$ / stage</th><th class="num">time / stage</th><th class="num">score / $</th>
    </tr></thead>
    <tbody>${rows.map((r, i) => `
      <tr><td class="rank${i === 0 ? ' top' : ''}">${i + 1}</td>
        <td><a href="/agents/${encodeURIComponent(r.agent)}/">${esc(r.agent)}</a></td>
        <td><span class="pill muted">${esc(r.provider)}</span></td>
        <td><a href="/models/${encodeURIComponent(r.model_id)}/"><b>${esc(r.model)}</b></a></td>
        <td style="min-width:200px">${bar(r.avg_rating_score)}</td>
        <td class="num">${fmtPct(r.success_rate)}</td>
        <td class="num">${r.run_count}</td>
        <td class="num">${r.stage_count}</td>
        <td class="num">${fmtMoney(r.avg_cost_per_stage)}</td>
        <td class="num">${fmtDuration(r.avg_duration_sec)}</td>
        <td class="num">${r.rating_per_dollar == null ? '—' : (Number(r.rating_per_dollar) * 10).toFixed(2)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

/* ────────────────────────────── 03 · TESTS ────────────────────────────── */
async function renderTests(selectedName, gen) {
  const tests = DATA.tests;

  // /tests/ (no selection): show only the list of tests, as a wrapping mosaic
  // of cards. Clicking a card routes to /tests/<name>/ for the detail page.
  if (!selectedName) {
    view().innerHTML = `
      ${viewHead('tests', '03', 'Browse community-defined tests, their stage prompts, and the runs contributed against each.')}
      ${tests.length
        ? `<nav class="catalog-tabs mosaic" aria-label="tests">${tests.map((t) => testTabHTML(t, false)).join('')}</nav>`
        : '<div class="panel"><div class="panel-body t-mute">no tests yet.</div></div>'}
    `;
    return;
  }

  // /tests/<name>/: show only the detail page for the selected test (it
  // lazy-loads tests/<name>.json and carries its own breadcrumb back to /tests/).
  const selected = tests.find((t) => t.name === selectedName);
  if (!selected) {
    view().innerHTML = `<div class="panel"><div class="panel-body t-mute">test not found.</div></div>`;
    return;
  }
  view().innerHTML = SKELETON;
  try {
    const test = await loadTest(selected.name);
    if (isStale(gen)) return;
    view().innerHTML = testDetailHTML(test);
    mountTestThemeChart(test);
  } catch (err) {
    if (isStale(gen)) return;
    view().innerHTML = errorPanelHTML(err);
  }
}

function testTabHTML(t, isActive) {
  return `<a class="catalog-tab ${isActive ? 'active' : ''}" href="/tests/${esc(t.name)}/">
    <div class="catalog-tab-head">
      <div class="catalog-tab-name">${esc(t.title)}</div>
      ${t.domain ? `<div class="catalog-tab-type">${esc(t.domain)}</div>` : ''}
    </div>
    <div class="catalog-tab-badges">
      <span class="catalog-tab-badge">${t.run_count} run${t.run_count === 1 ? '' : 's'}</span>
      <span class="catalog-tab-badge">${t.stages_total} stage${t.stages_total === 1 ? '' : 's'}</span>
      ${t.stack ? `<span class="catalog-tab-badge alt">${esc(t.stack_name || t.stack)}</span>` : ''}
      ${t.top_score != null ? `<span class="catalog-tab-badge">top ${fmtScore(t.top_score)}</span>` : ''}
    </div>
  </a>`;
}

function testDetailHTML(t) {
  return `
    <div class="crumbs">
      <a href="/tests/">tests</a><span class="sep">/</span><span class="cur">${esc(t.name)}</span>
    </div>
    ${viewHead(t.title, '', '')}
    <div class="panel">
      <div class="panel-head">
        <span class="panel-title">test details</span>
        <span class="panel-actions">
          ${t.domain ? `<span class="pill">${esc(t.domain)}</span>` : ''}
          ${t.stack ? `<a class="pill magenta" href="/stacks/${encodeURIComponent(t.stack)}/">${esc(t.stack_name || t.stack)}</a>` : ''}
          <span class="pill muted">${esc(t.name)}</span>
        </span>
      </div>
      <div class="panel-body">
        <p style="margin:0 0 16px; color:var(--text-dim)">${esc(t.description)}</p>
        <div class="kv-grid">
          ${t.contributor_handle ? `<div><span class="k">authored by</span><span class="v"><a class="author-inline" href="/contributors/${encodeURIComponent(t.contributor_handle)}/">${t.contributor_avatar ? `<img class="avatar-thumb" src="${esc(t.contributor_avatar)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}<span>${esc(t.contributor_handle)}</span></a></span></div>` : ''}
          ${t.domain ? `<div><span class="k">domain</span><span class="v"><span class="pill">${esc(t.domain)}</span></span></div>` : ''}
          ${t.stack ? `<div><span class="k">tech stack</span><span class="v"><a class="pill magenta" href="/stacks/${encodeURIComponent(t.stack)}/">${esc(t.stack_name || t.stack)}</a></span></div>` : ''}
          <div><span class="k">stages</span><span class="v">${t.stages_total}</span></div>
          <div><span class="k">contributed runs</span><span class="v">${t.run_count}</span></div>
          <div><span class="k">top score</span><span class="v t-cyan">${fmtScoreDetail(t.runs[0]?.avg_rating_score)}</span></div>
          <div><span class="k">source</span><span class="v"><a href="${esc(DATA.github_url)}/tree/main/tests/${esc(t.name)}" rel="noopener">/tests/${esc(t.name)}</a></span></div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><span class="panel-title">stage prompts</span></div>
      <div class="panel-body">
        <div class="stages">${t.test_stages.map((s, i) => `
          <div class="stage">
            <div class="idx">${String(i + 1).padStart(2, '0')}</div>
            <div>
              <div class="head">
                <span class="id">${esc(s.id)}</span>
                <span class="pill magenta">${esc(s.theme)}</span>
                ${s.builds_on ? `<span class="builds">builds on <code>${esc(s.builds_on)}</code></span>` : ''}
              </div>
              <div class="prompt">${esc(s.prompt)}</div>
            </div>
          </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="split-2">
      <div class="panel">
        <div class="panel-head"><span class="panel-title">stage rating distribution</span></div>
        <div class="panel-body"><div class="chart-box"><canvas id="testThemeChart"></canvas></div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><span class="panel-title alt">contributed runs</span><span class="panel-actions t-mute">${t.runs.length} run${t.runs.length === 1 ? '' : 's'}</span></div>
        <div class="panel-body dense">${runsTableHTML(t.runs, { showTest: false })}</div>
      </div>
    </div>
  `;
}

/* ─────────────────────── AGENTS · PROVIDERS (master-detail) ─────────────────────── */
// Both views share the same template — the only differences are the list source,
// the route prefix, and the cross-reference axis label. Encapsulated in `kind`.

const CATALOG_KINDS = {
  agents: {
    list:       () => DATA.agents || [],
    load:       (id) => loadAgent(id),
    route:      'agents',
    routeOther: 'providers',
    tag:        '07',
    title:      'coding agents',
    lead:       'All coding agents observed across contributed runs. Click an agent to see its providers, tests, and full activity.',
    crumb:      'agents',
    eyebrow:    'coding agent',
    countSing:  'agent',
    countPlur:  'agents',
    crossLabel: 'providers used',
    crossKey:   'provider',
    hasCatalog: true,
  },
  providers: {
    list:       () => DATA.providers || [],
    load:       (id) => loadProvider(id),
    route:      'providers',
    routeOther: 'agents',
    tag:        '08',
    title:      'inference providers',
    lead:       'All inference providers observed across contributed runs. Click a provider to see its agents, tests, and full activity.',
    crumb:      'providers',
    eyebrow:    'inference provider',
    countSing:  'provider',
    countPlur:  'providers',
    crossLabel: 'agents used',
    crossKey:   'agent',
    hasCatalog: true,
  },
  models: {
    list:       () => DATA.models || [],
    load:       (id) => loadModel(id),
    route:      'models',
    routeOther: 'providers',
    tag:        '09',
    title:      'models',
    lead:       'All models observed across contributed runs. Click a model to see its providers, tests, and full activity.',
    crumb:      'models',
    eyebrow:    'model',
    countSing:  'model',
    countPlur:  'models',
    crossLabel: 'providers serving',
    crossKey:   'provider',
    // Models intentionally have no catalog JSON — they change too often and
    // names are too unpredictable — so the "unlisted" hint doesn't apply.
    hasCatalog: false,
  },
  stacks: {
    list:       () => DATA.stacks || [],
    load:       (id) => loadStack(id),
    route:      'stacks',
    routeOther: 'models',
    tag:        '10',
    title:      'tech stacks',
    lead:       'Per-stack breakdown of activity — which models rank best on each tech stack, and the tests that target it.',
    crumb:      'stacks',
    eyebrow:    'tech stack',
    countSing:  'stack',
    countPlur:  'stacks',
    crossLabel: 'models ranked',
    crossKey:   'model',
    hasCatalog: true,
    // Stacks add a "models ranked" bar chart to the detail page (the cross axis
    // is models, so the cross table doubles as a per-stack model ranking).
    crossChart: 'models ranked on this stack',
  },
};

function catalogTabHTML(kind, item, isActive) {
  const initial = (item.name || item.id || '?').trim().charAt(0).toUpperCase();
  const logoHTML = item.logo
    ? `<img class="catalog-tab-logo" src="${esc(item.logo)}" alt="" data-initial="${esc(initial)}" loading="lazy" onerror="logoFallback(this)" />`
    : '';
  return `<a class="catalog-tab ${isActive ? 'active' : ''}" href="/${kind.route}/${encodeURIComponent(item.id)}/">
    <div class="catalog-tab-id">
      ${logoHTML}
      <div class="catalog-tab-head">
        <div class="catalog-tab-name">${esc(item.name || item.id)}${kind.hasCatalog && !item.in_catalog ? ' <span class="pill muted">unlisted</span>' : ''}</div>
        ${item.category ? `<div class="catalog-tab-type">${esc(item.category)}</div>` : ''}
      </div>
    </div>
    <div class="catalog-tab-badges">
      <span class="catalog-tab-badge">${item.run_count} run${item.run_count === 1 ? '' : 's'}</span>
      <span class="catalog-tab-badge">${item.test_count} test${item.test_count === 1 ? '' : 's'}</span>
      ${item.avg_rating_score != null ? `<span class="catalog-tab-badge">top ${fmtScore(item.avg_rating_score)}</span>` : ''}
    </div>
  </a>`;
}

function catalogDetailHTML(kind, d) {
  // Fallback for entries without a logo (or where the image 404s at runtime):
  // show the first letter of the name in a large font. The onerror handler
  // reads the initial off a data attribute so any character is HTML-safe.
  const initial = (d.name || d.id || '?').trim().charAt(0).toUpperCase();
  const logoHTML = d.logo
    ? `<img class="catalog-logo" src="${esc(d.logo)}" alt="${esc(d.name)} logo" data-initial="${esc(initial)}" onerror="logoFallback(this)" />`
    : `<span class="catalog-logo fallback">${esc(initial)}</span>`;

  const crossRows = d.cross.map((c) => `
    <tr class="clickable" onclick="rowNav(event, '/${kind.routeOther}/${encodeURIComponent(c[kind.crossKey])}/')">
      <td><code>${esc(c[kind.crossKey])}</code></td>
      <td class="num">${c.run_count}</td>
      <td class="num">${c.stage_count}</td>
      <td style="min-width:170px">${bar(c.avg_rating_score)}</td>
    </tr>`).join('');

  const testRows = d.tests.map((t) => `
    <tr class="clickable" onclick="rowNav(event, '/tests/${encodeURIComponent(t.test_name)}/')">
      <td>${esc(t.test_name)}</td>
      <td class="t-mute">${esc(t.test_title)}</td>
      <td class="num">${t.run_count}</td>
      <td class="num">${t.stage_count}</td>
      <td style="min-width:170px">${bar(t.avg_rating_score)}</td>
    </tr>`).join('');

  return `
    <div class="crumbs">
      <a href="/${kind.route}/">${esc(kind.crumb)}</a><span class="sep">/</span><span class="cur">${esc(d.id)}</span>
    </div>

    <section class="catalog-hero">
      <div class="catalog-hero-logo">${logoHTML}</div>
      <div class="catalog-hero-main">
        <div class="profile-eyebrow t-mute">▌ ${esc(kind.eyebrow)}</div>
        <h1 class="profile-handle">${esc(d.name || d.id)}</h1>
        ${d.description ? `<p class="catalog-hero-desc t-mute">${esc(d.description)}</p>` : ''}
        <div class="catalog-hero-meta">
          ${d.category ? `<span class="pill">${esc(d.category)}</span>` : ''}
          ${d.vendor_name ? `<span class="pill">by ${esc(d.vendor_name)}</span>` : ''}
          <span class="pill muted">id: ${esc(d.id)}</span>
          ${d.homepage ? `<a class="profile-link" href="${esc(d.homepage)}" rel="noopener">${esc(d.homepage)}</a>` : ''}
          ${kind.hasCatalog && !d.in_catalog ? `<span class="pill muted">unlisted — add to /${esc(kind.route)}.json</span>` : ''}
        </div>
        ${d.top_combo ? `<div class="profile-meta">top combo: <b>${esc(d.top_combo)}</b></div>` : ''}
      </div>
      <div class="profile-stats">
        <div class="profile-stat"><span class="k">runs</span><span class="v">${d.run_count}</span></div>
        <div class="profile-stat"><span class="k">stages</span><span class="v">${d.stage_count}</span></div>
        <div class="profile-stat"><span class="k">tests</span><span class="v">${d.test_count}</span></div>
        <div class="profile-stat"><span class="k">contributors</span><span class="v">${d.contributor_count}</span></div>
        <div class="profile-stat"><span class="k">avg score</span><span class="v t-cyan">${fmtScoreDetail(d.avg_rating_score)}</span></div>
        <div class="profile-stat"><span class="k">total cost</span><span class="v">${fmtMoney(d.total_cost_usd)}</span></div>
        <div class="profile-stat"><span class="k">total time</span><span class="v">${fmtDuration(d.total_duration_sec)}</span></div>
      </div>
    </section>

    <div class="split-2">
      <div class="panel">
        <div class="panel-head"><span class="panel-title">${esc(kind.crossLabel)}</span><span class="panel-actions t-mute">${d.cross.length}</span></div>
        <div class="panel-body dense">
          ${d.cross.length ? `<table><thead><tr><th>${esc(kind.crossKey)}</th><th class="num">runs</th><th class="num">stages</th><th>score</th></tr></thead><tbody>${crossRows}</tbody></table>` : '<div style="padding:14px;color:var(--text-mute)">none yet.</div>'}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><span class="panel-title alt">tests covered</span><span class="panel-actions t-mute">${d.tests.length}</span></div>
        <div class="panel-body dense">
          ${d.tests.length ? `<table><thead><tr><th>test</th><th>title</th><th class="num">runs</th><th class="num">stages</th><th>score</th></tr></thead><tbody>${testRows}</tbody></table>` : '<div style="padding:14px;color:var(--text-mute)">none yet.</div>'}
        </div>
      </div>
    </div>

    ${d.stacks && d.stacks.length ? `
    <div class="panel">
      <div class="panel-head"><span class="panel-title">tech stacks used</span><span class="panel-actions t-mute">${d.stacks.length} stack${d.stacks.length === 1 ? '' : 's'} · avg score on each</span></div>
      <div class="panel-body dense">
        <table>
          <thead><tr><th>stack</th><th class="num">runs</th><th class="num">stages</th><th>avg score</th></tr></thead>
          <tbody>${d.stacks.map((s) => `
            <tr class="clickable" onclick="rowNav(event, '/stacks/${encodeURIComponent(s.stack)}/')">
              <td>${esc(s.stack_name || s.stack)}</td>
              <td class="num">${s.run_count}</td>
              <td class="num">${s.stage_count}</td>
              <td style="min-width:170px">${bar(s.avg_rating_score)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}

    ${kind.crossChart ? `
    <div class="panel">
      <div class="panel-head"><span class="panel-title">${esc(kind.crossChart)}</span><span class="panel-actions t-mute">${d.cross.length} ${esc(kind.crossKey)}${d.cross.length === 1 ? '' : 's'}</span></div>
      <div class="panel-body">
        ${d.cross.length
          ? `<div class="chart-box tall"><canvas id="catalogCrossChart"></canvas></div>`
          : '<div style="padding:14px;color:var(--text-mute)">no runs yet.</div>'}
      </div>
    </div>` : ''}

    <div class="panel">
      <div class="panel-head"><span class="panel-title">usage over time</span><span class="panel-actions t-mute">${d.activity.length} day${d.activity.length === 1 ? '' : 's'}</span></div>
      <div class="panel-body">
        ${d.activity.length
          ? `<div class="chart-box"><canvas id="catalogActivityChart"></canvas></div>`
          : '<div style="padding:14px;color:var(--text-mute)">no runs yet.</div>'}
      </div>
    </div>
  `;
}

function mountCatalogActivity(activity) {
  if (!activity || !activity.length) return;
  makeChart('catalogActivityChart', {
    type: 'line',
    data: {
      labels: activity.map((a) => a.date),
      datasets: [{
        data: activity.map((a) => a.count),
        borderColor: '#5ad1ff',
        backgroundColor: 'rgba(90,209,255,.15)',
        borderWidth: 1.5,
        fill: true, tension: .3,
        pointRadius: 3, pointHoverRadius: 5,
        pointBackgroundColor: '#ff6ad5',
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: COMMON_TOOLTIP },
      scales: {
        x: { ...COMMON_SCALES, ticks: { ...COMMON_SCALES.ticks, maxRotation: 0, autoSkipPadding: 14 } },
        y: { ...COMMON_SCALES, beginAtZero: true, ticks: { ...COMMON_SCALES.ticks, precision: 0 } },
      },
    },
  });
}

async function renderCatalog(kind, selectedId, gen) {
  const items = kind.list();

  // /<kind>/ (no selection): show only the list, as a wrapping mosaic of cards.
  // Clicking a card routes to /<kind>/<id>/ for the detail page.
  if (!selectedId) {
    view().innerHTML = `
      ${viewHead(kind.title, kind.tag, kind.lead)}
      ${items.length
        ? `<nav class="catalog-tabs mosaic" aria-label="${esc(kind.countPlur)}">${items.map((x) => catalogTabHTML(kind, x, false)).join('')}</nav>`
        : '<div class="panel"><div class="panel-body t-mute">no entries yet.</div></div>'}
    `;
    return;
  }

  // /<kind>/<id>/: show only the detail page (it lazy-loads <kind>/<id>.json and
  // carries its own hero header + breadcrumb back to /<kind>/).
  const selected = items.find((x) => x.id === selectedId);
  if (!selected) {
    view().innerHTML = `<div class="panel"><div class="panel-body t-mute">${esc(kind.countSing)} not found.</div></div>`;
    return;
  }
  view().innerHTML = SKELETON;
  try {
    const detail = await kind.load(selected.id);
    if (isStale(gen)) return;
    view().innerHTML = catalogDetailHTML(kind, detail);
    mountCatalogActivity(detail.activity);
    if (kind.crossChart) mountCrossBarChart('catalogCrossChart', detail.cross, kind.crossKey);
  } catch (err) {
    if (isStale(gen)) return;
    view().innerHTML = errorPanelHTML(err);
  }
}

const renderAgents    = (id, gen) => renderCatalog(CATALOG_KINDS.agents, id, gen);
const renderProviders = (id, gen) => renderCatalog(CATALOG_KINDS.providers, id, gen);
const renderModels    = (id, gen) => renderCatalog(CATALOG_KINDS.models, id, gen);
const renderStacks    = (id, gen) => renderCatalog(CATALOG_KINDS.stacks, id, gen);

function runsTableHTML(runs, opts = {}) {
  const { showTest = true } = opts;
  if (!runs.length) return '<div style="padding:14px;color:var(--text-mute)">no runs yet.</div>';
  return `<table>
    <thead><tr>
      ${showTest ? '<th>test</th>' : ''}
      <th>contributor</th><th>agent · model</th>
      <th>stages</th><th>score</th>
      <th class="num">cost</th><th class="num">time</th><th class="num">date</th>
    </tr></thead>
    <tbody>${runs.map((r) => `
      <tr class="clickable" onclick="rowNav(event, '/tests/${esc(r.test_name)}/runs/${esc(r.run_id)}/')">
        ${showTest ? `<td>${esc(r.test_name)}</td>` : ''}
        <td><span class="author-inline">${r.contributor_avatar ? `<img class="avatar-thumb" src="${esc(r.contributor_avatar)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}<span>${esc(r.contributor_handle)}</span></span></td>
        <td>${esc(r.agent)} · <b>${esc(r.model)}</b> <span class="pill muted">${esc(r.provider)}</span></td>
        <td>${ratingDots(r.stages, r.stages_total)}</td>
        <td style="min-width:170px">${bar(r.avg_rating_score)}</td>
        <td class="num">${fmtMoney(r.total_cost_usd)}</td>
        <td class="num">${fmtDuration(r.total_duration_sec)}</td>
        <td class="num t-mute">${fmtDate(r.date)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

/* ────────────────────────────── 04 · RUNS ────────────────────────────── */
async function renderRuns(gen) {
  view().innerHTML = `
    ${viewHead('runs', '04', 'All contributed runs across every test. Click a row to inspect stages, costs, and notes.')}
    <div id="runsSlot">${SKELETON}</div>
  `;
  const runs = await loadRuns();
  if (isStale(gen)) return;
  $('#runsSlot').innerHTML = `
    <div class="panel">
      <div class="panel-head"><span class="panel-title">all runs</span><span class="panel-actions t-mute">${runs.length} run${runs.length === 1 ? '' : 's'}</span></div>
      <div class="panel-body dense">${runsTableHTML(runs, { showTest: true })}</div>
    </div>
  `;
}

/* ─────────────────────────── RUN DETAIL view ─────────────────────────── */
async function renderRunDetail(testName, runId, parentRoute, gen) {
  view().innerHTML = `
    <div class="crumbs">
      <a href="/${esc(parentRoute || 'tests')}/">${esc(parentRoute === 'runs' ? 'all runs' : 'tests')}</a><span class="sep">/</span>
      <a href="/tests/${esc(testName)}/">${esc(testName)}</a><span class="sep">/</span>
      <span class="cur">${esc(runId)}</span>
    </div>
    ${SKELETON}
  `;
  const [run, test] = await Promise.all([
    loadRun(testName, runId),
    loadTest(testName),
  ]);
  if (isStale(gen)) return;
  if (!run || !test) {
    view().innerHTML = `<div class="panel"><div class="panel-body t-mute">run not found.</div></div>`;
    return;
  }

  const settings = run.settings && Object.keys(run.settings).length ? run.settings : null;
  const hw = run.hardware;

  view().innerHTML = `
    <div class="crumbs">
      <a href="/${esc(parentRoute || 'tests')}/">${esc(parentRoute === 'runs' ? 'all runs' : 'tests')}</a><span class="sep">/</span>
      <a href="/tests/${esc(testName)}/">${esc(testName)}</a><span class="sep">/</span>
      <span class="cur">${esc(runId)}</span>
    </div>

    ${viewHead(`${testName} run by ${run.contributor_handle}`, '', esc(run.run_id))}

    <div class="run-detail">
      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">run metadata</span>
          <span class="panel-actions">
            <span class="pill muted">${esc(run.provider)}</span>
            ${run.framework ? `<span class="pill muted">${esc(run.framework)}</span>` : ''}
            ${run.quantization ? `<span class="pill muted">${esc(run.quantization)}</span>` : ''}
          </span>
        </div>
        <div class="panel-body">
          <div class="kv-grid">
            <div><span class="k">test</span><span class="v"><a href="/tests/${esc(testName)}/">${esc(test.title || testName)}</a></span></div>
            <div><span class="k">contributor</span><span class="v"><a class="author-inline" href="/contributors/${encodeURIComponent(run.contributor_handle)}/">${run.contributor_avatar ? `<img class="avatar-thumb" src="${esc(run.contributor_avatar)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}<span>${esc(run.contributor_handle)}</span></a></span></div>
            <div><span class="k">date</span><span class="v">${esc(run.date)}</span></div>
            <div><span class="k">agent</span><span class="v">${esc(run.agent)}${run.agent_plan ? ` <span class="t-mute">· ${esc(run.agent_plan)}</span>` : ''}</span></div>
            <div><span class="k">model</span><span class="v">${esc(run.model)}</span></div>
            <div><span class="k">avg score</span><span class="v t-cyan">${fmtScoreDetail(run.avg_rating_score)}</span></div>
            <div><span class="k">stages</span><span class="v">${run.stages_run} / ${run.stages_total}</span></div>
            <div><span class="k">total cost</span><span class="v">${fmtMoney(run.total_cost_usd)}</span></div>
            <div><span class="k">total time</span><span class="v">${fmtDuration(run.total_duration_sec)}</span></div>
          </div>
        </div>
      </div>

      <div class="split-2">
        <div class="panel">
          <div class="panel-head"><span class="panel-title">stage timeline</span></div>
          <div class="panel-body"><div class="chart-box"><canvas id="runStageChart"></canvas></div></div>
        </div>
        <div class="panel">
          <div class="panel-head"><span class="panel-title alt">cost · duration · rating</span></div>
          <div class="panel-body"><div class="chart-box"><canvas id="runMetricChart"></canvas></div></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><span class="panel-title">stage details</span></div>
        <div class="panel-body dense">${runStageTableHTML(run, test)}</div>
      </div>

      ${(hw || settings) ? `
      <div class="split-2">
        ${hw ? `<div class="panel">
          <div class="panel-head"><span class="panel-title">hardware</span></div>
          <div class="panel-body"><div class="kv-grid">
            ${hw.device  ? `<div><span class="k">device</span><span class="v">${esc(hw.device)}</span></div>`  : ''}
            ${hw.gpu     ? `<div><span class="k">gpu</span><span class="v">${esc(hw.gpu)}</span></div>`     : ''}
            ${hw.vram_gb != null ? `<div><span class="k">vram</span><span class="v">${hw.vram_gb} gb</span></div>` : ''}
            ${hw.ram_gb  != null ? `<div><span class="k">ram</span><span class="v">${hw.ram_gb} gb</span></div>`  : ''}
          </div></div>
        </div>` : ''}
        ${settings ? `<div class="panel">
          <div class="panel-head"><span class="panel-title alt">settings</span></div>
          <div class="panel-body"><div class="kv-grid">${
            Object.entries(settings).map(([k, v]) => `<div><span class="k">${esc(k)}</span><span class="v">${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</span></div>`).join('')
          }</div></div>
        </div>` : ''}
      </div>` : ''}
    </div>
  `;
  mountRunStageChart(run, test);
  mountRunMetricChart(run);
}

function runStageTableHTML(run, test) {
  const themeBy = Object.fromEntries((test.test_stages || []).map((s) => [s.id, s.theme]));
  return `<table class="stages-table">
    <thead><tr>
      <th>#</th><th>stage</th><th>theme</th><th>rating</th>
      <th class="num">duration</th><th class="num">tokens in</th><th class="num">tokens out</th><th class="num">cost</th><th>notes</th>
    </tr></thead>
    <tbody>${run.stages.map((s, i) => `
      <tr>
        <td class="rank">${String(i + 1).padStart(2, '0')}</td>
        <td class="stage-cell"><b>${esc(s.id)}</b>${s.source_path ? `<a class="src-btn" href="${esc(DATA.github_url)}/tree/main/${esc(s.source_path)}" rel="noopener" title="View source on GitHub"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2.9-.3 2-.4 3-.4s2.1.1 3 .4c2.3-1.6 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"/></svg><span>source</span></a>` : ''}</td>
        <td>${themeBy[s.id] ? `<span class="pill magenta">${esc(themeBy[s.id])}</span>` : '—'}</td>
        <td><span class="dot" style="background:${RATING_COLOR[s.rating]}; margin-right:6px"></span>${esc(s.rating)}</td>
        <td class="num">${fmtDuration(s.duration_sec)}</td>
        <td class="num">${fmtNum(s.tokens_in)}</td>
        <td class="num">${fmtNum(s.tokens_out)}</td>
        <td class="num">${fmtMoney(s.cost_usd)}</td>
        <td>${s.notes ? `<span class="notes">${esc(s.notes)}</span>` : '<span class="t-mute">—</span>'}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

/* ─────────────────────────── 05 · CONTRIBUTORS ─────────────────────────── */
function renderContributors() {
  const c = DATA.contributors;
  view().innerHTML = `
    ${viewHead('contributors', '05', 'Folks running these tests against agents. Click a handle to see their full contribution profile.')}

    <div class="panel">
      <div class="panel-head"><span class="panel-title alt">contribution activity</span><span class="panel-actions t-mute">${DATA.activity.length} active days</span></div>
      <div class="panel-body"><div class="chart-box"><canvas id="contribActivityChart"></canvas></div></div>
    </div>

    <div class="panel">
      <div class="panel-head"><span class="panel-title">leaderboard · ranked by contributions</span><span class="panel-actions t-mute">${c.profiles.length} contributor${c.profiles.length === 1 ? '' : 's'}</span></div>
      <div class="panel-body dense">${contribCardsHTML(c.profiles)}</div>
    </div>

    <div class="panel">
      <div class="panel-head"><span class="panel-title alt">latest contributions</span></div>
      <div class="panel-body dense">${recentContribHTML(c.recent || [])}</div>
    </div>
  `;
  mountActivity('contribActivityChart');
}

function avatarThumb(p, size = 26) {
  if (p.avatar_url) {
    return `<img class="avatar-thumb" src="${esc(p.avatar_url)}" alt="" width="${size}" height="${size}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'avatar-thumb placeholder',textContent:'▌'}))">`;
  }
  return `<span class="avatar-thumb placeholder" style="width:${size}px;height:${size}px;line-height:${size - 2}px">▌</span>`;
}

function contribCardsHTML(rows) {
  if (!rows.length) return '<div style="padding:14px;color:var(--text-mute)">none yet.</div>';
  return `<ul class="contrib-rank">${rows.map((r) => {
    const sub = [];
    if (r.top_combo) sub.push(esc(r.top_combo));
    if (r.top_rig) sub.push(esc(r.top_rig));   // weapon of choice (self-hosted rigs only)
    sub.push(`active until ${fmtDate(r.latest_date)}`);
    return `
    <li>
      <a class="contrib-row" href="/contributors/${encodeURIComponent(r.handle)}/">
        <span class="contrib-rank-n${r.rank === 1 ? ' top' : ''}">#${r.rank}</span>
        ${avatarThumb(r, 36)}
        <div class="contrib-id">
          <div class="handle">${esc(r.handle)}</div>
          <div class="sub">${sub.join(' · ')}</div>
        </div>
        <div class="contrib-nums">
          <div><b>${r.run_count}</b><span>runs</span></div>
          <div><b>${r.stage_count}</b><span>stages</span></div>
          <div><b>${r.test_count}</b><span>tests</span></div>
        </div>
        <div class="contrib-score">${bar(r.avg_rating_score)}</div>
      </a>
    </li>`;
  }).join('')}</ul>`;
}

function recentContribHTML(rows) {
  if (!rows.length) return '<div style="padding:14px;color:var(--text-mute)">none yet.</div>';
  return `<table>
    <thead><tr><th>date</th><th>handle</th><th>test · run</th><th>agent · model</th></tr></thead>
    <tbody>${rows.map((c) => `
      <tr class="clickable" onclick="rowNav(event, '/tests/${esc(c.test_name)}/runs/${esc(c.run_id)}/')">
        <td class="t-mute">${esc(c.date)}</td>
        <td>${esc(c.handle)}</td>
        <td>${esc(c.test_name)} · <code>${esc(c.run_id)}</code></td>
        <td>${esc(c.agent)} · <b>${esc(c.model)}</b> <span class="pill muted">${esc(c.provider)}</span></td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

/* ────────────────────── contributor profile (sub-route) ────────────────────── */
async function renderContributorProfile(handle, gen) {
  view().innerHTML = `
    <div class="crumbs">
      <a href="/contributors/">contributors</a><span class="sep">/</span><span class="cur">${esc(handle)}</span>
    </div>
    ${SKELETON}
  `;
  let p;
  try {
    p = await loadContributor(handle);
  } catch (err) {
    if (isStale(gen)) return;
    view().innerHTML = `<div class="crumbs"><a href="/contributors/">contributors</a><span class="sep">/</span><span class="cur">${esc(handle)}</span></div>${errorPanelHTML(err)}`;
    return;
  }
  if (isStale(gen)) return;
  if (!p) {
    view().innerHTML = `<div class="crumbs"><a href="/contributors/">contributors</a><span class="sep">/</span><span class="cur">${esc(handle)}</span></div>
      <div class="panel"><div class="panel-body t-mute">contributor not found.</div></div>`;
    return;
  }

  const tests = new Map();
  for (const r of p.runs) {
    if (!tests.has(r.test_name)) tests.set(r.test_name, { name: r.test_name, title: r.test_title, count: 0 });
    tests.get(r.test_name).count++;
  }

  view().innerHTML = `
    <div class="crumbs">
      <a href="/contributors/">contributors</a><span class="sep">/</span><span class="cur">${esc(p.handle)}</span>
    </div>

    <section class="profile-hero">
      <div class="profile-hero-grid">
        <div class="profile-avatar">
          ${p.avatar_url
            ? `<img src="${esc(p.avatar_url)}" alt="${esc(p.handle)}" loading="eager" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'profile-avatar-fallback',textContent:'▌'}))">`
            : '<div class="profile-avatar-fallback">▌</div>'}
          <div class="profile-rank${p.rank === 1 ? ' top' : ''}">#${p.rank}</div>
        </div>
        <div class="profile-main">
          <div class="profile-eyebrow">▌ contributor</div>
          <h1 class="profile-handle">${esc(p.handle)}</h1>
          <p class="profile-link"><a href="${esc(p.url)}" rel="noopener">${esc(p.url)}</a></p>
          ${p.top_combo ? `<div class="profile-meta">favorite stack · <b>${esc(p.top_combo)}</b></div>` : ''}
          ${p.top_rig ? `<div class="profile-meta">weapon of choice · <b>${esc(p.top_rig)}</b></div>` : ''}
          <div class="profile-meta">active ${esc(p.first_date)} → ${esc(p.latest_date)}</div>
        </div>
        <div class="profile-stats">
          <div class="profile-stat"><div class="k">rank</div><div class="v t-magenta">#${p.rank}</div></div>
          <div class="profile-stat"><div class="k">runs</div><div class="v">${p.run_count}</div></div>
          <div class="profile-stat"><div class="k">stages</div><div class="v">${p.stage_count}</div></div>
          <div class="profile-stat"><div class="k">tests</div><div class="v">${p.test_count}</div></div>
          <div class="profile-stat"><div class="k">avg score</div><div class="v t-cyan">${fmtScoreDetail(p.avg_rating_score)}</div></div>
          <div class="profile-stat"><div class="k">total cost</div><div class="v">${fmtMoney(p.total_cost_usd)}</div></div>
          <div class="profile-stat"><div class="k">total time</div><div class="v">${fmtDuration(p.total_duration_sec)}</div></div>
        </div>
      </div>
    </section>

    <div class="split-2">
      <div class="panel">
        <div class="panel-head"><span class="panel-title">tests covered</span><span class="panel-actions t-mute">${tests.size} of ${DATA.tests.length}</span></div>
        <div class="panel-body dense">
          <table>
            <thead><tr><th>test</th><th class="num">runs</th></tr></thead>
            <tbody>${[...tests.values()].sort((a, b) => b.count - a.count).map((t) => `
              <tr class="clickable" onclick="rowNav(event, '/tests/${esc(t.name)}/')">
                <td>${esc(t.title)} <span class="pill muted">${esc(t.name)}</span></td>
                <td class="num">${t.count}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><span class="panel-title alt">rating breakdown</span></div>
        <div class="panel-body"><div class="chart-box"><canvas id="contribRatingChart"></canvas></div></div>
      </div>
    </div>

    ${(p.rigs && p.rigs.length) ? `
      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">arsenal</span>
          <span class="panel-actions t-mute">${p.rigs.length} rig${p.rigs.length === 1 ? '' : 's'} · most performant first</span>
        </div>
        <div class="panel-body dense">
          <table>
            <thead><tr>
              <th class="rank">#</th>
              <th>device · gpu</th>
              <th class="num">vram</th>
              <th class="num">ram</th>
              <th>models run</th>
              <th>framework</th>
              <th class="num">tok/s</th>
              <th class="num">avg time</th>
              <th>score</th>
              <th class="num">runs · stages</th>
            </tr></thead>
            <tbody>${p.rigs.map((r, i) => `
              <tr>
                <td class="rank${i === 0 ? ' top' : ''}">${i + 1}</td>
                <td><b>${esc(r.device || '—')}</b>${r.gpu ? ` · <span class="t-dim">${esc(r.gpu)}</span>` : ''}</td>
                <td class="num">${r.vram_gb ? r.vram_gb + ' gb' : '—'}</td>
                <td class="num">${r.ram_gb ? r.ram_gb + ' gb' : '—'}</td>
                <td>${r.models.map((m) => `<span class="pill muted">${esc(m)}</span>`).join(' ') || '<span class="t-mute">—</span>'}</td>
                <td>${r.frameworks.length ? r.frameworks.map((f) => `<span class="pill">${esc(f)}</span>`).join(' ') : '<span class="t-mute">—</span>'}</td>
                <td class="num t-cyan">${r.avg_tokens_per_sec != null ? Number(r.avg_tokens_per_sec).toFixed(1) : '—'}</td>
                <td class="num">${fmtDuration(r.avg_duration_sec)}</td>
                <td style="min-width:140px">${bar(r.avg_rating_score)}</td>
                <td class="num">${r.run_count} · ${r.stage_count}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}

    ${(() => {
      const authored = (DATA.tests || []).filter((x) => x.contributor_handle === p.handle);
      if (!authored.length) return '';
      return `
        <div class="panel">
          <div class="panel-head"><span class="panel-title alt">tests authored</span><span class="panel-actions t-mute">${authored.length} test${authored.length === 1 ? '' : 's'}</span></div>
          <div class="panel-body dense">
            <table>
              <thead><tr><th>test</th><th>domain</th><th class="num">stages</th><th class="num">runs</th><th class="num">top score</th></tr></thead>
              <tbody>${authored.map((t) => `
                <tr class="clickable" onclick="rowNav(event, '/tests/${esc(t.name)}/')">
                  <td>${esc(t.title)} <span class="pill muted">${esc(t.name)}</span></td>
                  <td>${t.domain ? `<span class="pill">${esc(t.domain)}</span>` : '<span class="t-mute">—</span>'}</td>
                  <td class="num">${t.stages_total}</td>
                  <td class="num">${t.run_count}</td>
                  <td class="num t-cyan">${fmtScore(t.top_score)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    })()}

    <div class="panel">
      <div class="panel-head"><span class="panel-title">all contributed runs</span><span class="panel-actions t-mute">${p.runs.length} run${p.runs.length === 1 ? '' : 's'}</span></div>
      <div class="panel-body dense">${runsTableHTML(p.runs, { showTest: true })}</div>
    </div>
  `;
  mountContribRatingChart(p);
}

/* ─────────────────────────── 10 · CONTRIBUTE ─────────────────────────── */
// Long-form contributor docs (formerly CONTRIBUTING.md). The page body is
// pre-rendered at build time from site_template/contribute/contribute.html
// and shipped in DATA.contribute_html — we just inject it here. The repo's
// CONTRIBUTING.md is now a stub that points to /contribute/ so GitHub's
// PR-template surface still works. The pre tags in the rendered fragment
// use [data-copy]; the global click/keydown delegation below handles copy.

function renderContribute() {
  view().innerHTML = DATA.contribute_html || '';
}

// Click-to-copy delegation for any [data-copy] element on the page. Falls
// back to a textarea-select hack on browsers without Clipboard API.
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-copy]');
  if (!el) return;
  _copyText(el);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('[data-copy]');
  if (!el) return;
  e.preventDefault();
  _copyText(el);
});
function _copyText(el) {
  const text = el.textContent;
  const done = () => {
    el.classList.add('copied');
    setTimeout(() => el.classList.remove('copied'), 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => _fallbackCopy(text, done));
  } else {
    _fallbackCopy(text, done);
  }
}
function _fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { /* noop */ }
  document.body.removeChild(ta);
}

/* ─────────────────────────── 06 · SILICON BEASTS ─────────────────────────── */
function renderHardware() {
  const h = DATA.hardware || { headline: { devices: 0, vram_gb: 0, ram_gb: 0, contributors: 0, runs: 0, stages: 0 }, combos: [], by_device: [], by_gpu: [], contributors: [] };
  const hd = h.headline;

  view().innerHTML = `
    ${viewHead('silicon beasts', '06', 'A roll-call of the self-hosted rigs powering local inference in this benchmark. Speed, hardware, and the contributors who threw silicon at the problem.')}

    ${hd.runs === 0 ? `
      <div class="panel"><div class="panel-body t-mute">No self-hosted runs yet — contribute one to launch this section.</div></div>
    ` : `
      <div class="metric-grid">
        <div class="metric cy"><div class="label">unique devices</div><div class="value">${hd.devices}</div><div class="sub">deduped per contributor</div></div>
        <div class="metric cy"><div class="label">total vram</div><div class="value">${hd.vram_gb} <span style="font-size:14px;color:var(--text-mute)">gb</span></div><div class="sub">across all rigs</div></div>
        <div class="metric"><div class="label">total ram</div><div class="value">${hd.ram_gb} <span style="font-size:14px;color:var(--text-mute)">gb</span></div><div class="sub">across all rigs</div></div>
        <div class="metric alt"><div class="label">contributors</div><div class="value">${hd.contributors}</div><div class="sub">running local</div></div>
        <div class="metric"><div class="label">self-hosted runs</div><div class="value">${hd.runs}</div><div class="sub">${hd.stages} stages</div></div>
      </div>

      <div class="split-2">
        <div class="panel">
          <div class="panel-head"><span class="panel-title">throughput by device</span><span class="panel-actions t-mute">tokens / sec, avg over stages</span></div>
          <div class="panel-body"><div class="chart-box"><canvas id="hwDeviceChart"></canvas></div></div>
        </div>
        <div class="panel">
          <div class="panel-head"><span class="panel-title alt">throughput by GPU</span><span class="panel-actions t-mute">tokens / sec, avg over stages</span></div>
          <div class="panel-body"><div class="chart-box"><canvas id="hwGpuChart"></canvas></div></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><span class="panel-title">most performant rigs</span><span class="panel-actions t-mute">${h.combos.length} unique combo${h.combos.length === 1 ? '' : 's'}</span></div>
        <div class="panel-body dense">${hardwareCombosHTML(h.combos)}</div>
      </div>

      <div class="panel">
        <div class="panel-head"><span class="panel-title alt">silicon beasts roster</span><span class="panel-actions t-mute">${h.contributors.length} contributor${h.contributors.length === 1 ? '' : 's'}</span></div>
        <div class="panel-body dense">${hardwareContributorsHTML(h.contributors)}</div>
      </div>

      <div class="panel">
        <div class="panel-body" style="display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap;">
          <div class="t-dim" style="font-size:12px;">▌ got a workstation, an M-series, an exotic GPU? show off how it performs.</div>
          <a class="cta cta-primary" href="/contribute/" rel="noopener">+ contribute a self-hosted run</a>
        </div>
      </div>
    `}
  `;

  if (hd.runs > 0) {
    mountHwBarChart('hwDeviceChart', h.by_device, 'device');
    mountHwBarChart('hwGpuChart',    h.by_gpu,    'gpu');
  }
}

function hardwareCombosHTML(rows) {
  if (!rows.length) return '<div style="padding:14px;color:var(--text-mute)">none yet.</div>';
  const contributorsCell = (r) => (r.contributors && r.contributors.length)
    ? r.contributors.map((c) =>
        `<a href="/contributors/${encodeURIComponent(c.handle)}/">${esc(c.handle)}</a>`).join(', ')
    : '<span class="t-mute">—</span>';
  return `<table>
    <thead><tr>
      <th class="rank">#</th>
      <th>device · gpu</th>
      <th>contributor</th>
      <th>framework</th>
      <th class="num">vram</th>
      <th class="num">ram</th>
      <th class="num">tok/s</th>
      <th class="num">avg time</th>
      <th>score</th>
      <th class="num">runs · stages</th>
    </tr></thead>
    <tbody>${rows.map((r) => `
      <tr>
        <td class="rank${r.rank === 1 ? ' top' : ''}">${r.rank}</td>
        <td><b>${esc(r.device || '—')}</b>${r.gpu ? ` · <span class="t-dim">${esc(r.gpu)}</span>` : ''}</td>
        <td>${contributorsCell(r)}</td>
        <td>${r.framework ? `<span class="pill">${esc(r.framework)}</span>` : '<span class="t-mute">—</span>'}</td>
        <td class="num">${r.vram_gb ? r.vram_gb + ' gb' : '—'}</td>
        <td class="num">${r.ram_gb ? r.ram_gb + ' gb' : '—'}</td>
        <td class="num t-cyan">${r.avg_tokens_per_sec != null ? Number(r.avg_tokens_per_sec).toFixed(1) : '—'}</td>
        <td class="num">${fmtDuration(r.avg_duration_sec)}</td>
        <td style="min-width:140px">${bar(r.avg_rating_score)}</td>
        <td class="num">${r.run_count} · ${r.stage_count}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function hardwareContributorsHTML(rows) {
  if (!rows.length) return '<div style="padding:14px;color:var(--text-mute)">none yet.</div>';
  return `<ul class="contrib-rank">${rows.map((r) => `
    <li>
      <a class="contrib-row" href="/contributors/${encodeURIComponent(r.handle)}/">
        <span class="contrib-rank-n${r.rank === 1 ? ' top' : ''}">#${r.rank}</span>
        ${avatarThumb(r, 36)}
        <div class="contrib-id">
          <div class="handle">${esc(r.handle)}</div>
          <div class="sub">${r.devices.map(esc).join(' + ') || '(no device)'}${r.gpus.length ? ' · ' + r.gpus.map(esc).join(', ') : ''}</div>
        </div>
        <div class="contrib-nums">
          <div><b>${r.total_vram_gb}</b><span>vram gb</span></div>
          <div><b>${r.total_ram_gb}</b><span>ram gb</span></div>
          <div><b>${r.stage_count}</b><span>stages</span></div>
          <div><b>${r.avg_tokens_per_sec != null ? Number(r.avg_tokens_per_sec).toFixed(0) : '—'}</b><span>tok/s</span></div>
        </div>
        <div class="contrib-score">${bar(r.avg_rating_score)}</div>
      </a>
    </li>`).join('')}</ul>`;
}

function mountHwBarChart(canvasId, rows, fieldName) {
  if (!rows.length) return;
  // Prefer tokens/sec; fall back to avg duration (lower=faster) shown as negative bars only if no tokens at all.
  const haveTokens = rows.some((r) => r.avg_tokens_per_sec != null);
  const sortKey = haveTokens ? 'avg_tokens_per_sec' : 'avg_duration_sec';
  const sorted = [...rows].sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0)).slice(0, 12);
  const labels = sorted.map((r) => r[fieldName] || '—');
  const data   = haveTokens
    ? sorted.map((r) => r.avg_tokens_per_sec || 0)
    : sorted.map((r) => r.avg_duration_sec || 0);

  makeChart(canvasId, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: sorted.map((_, i) => i === 0 ? '#ff6ad5' : 'rgba(90,209,255,.55)'),
        borderColor:     sorted.map((_, i) => i === 0 ? '#ff6ad5' : '#5ad1ff'),
        borderWidth: 1, borderRadius: 2,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...COMMON_TOOLTIP,
          callbacks: {
            label: (ctx) => {
              const r = sorted[ctx.dataIndex];
              return haveTokens
                ? [`${ctx.raw.toFixed(1)} tok/s`, `${r.stage_count} stages · score ${((r.avg_rating_score ?? 0) * 10).toFixed(1)}`]
                : [`${fmtDuration(ctx.raw)} avg`, `${r.stage_count} stages · score ${((r.avg_rating_score ?? 0) * 10).toFixed(1)}`];
            },
          },
        },
      },
      scales: {
        x: { ...COMMON_SCALES,
             title: { display: true, text: haveTokens ? 'tokens / second' : 'avg duration (sec)', color: '#5d6878', font: { size: 10 } } },
        y: { ...COMMON_SCALES, ticks: { ...COMMON_SCALES.ticks, font: { size: 10 } } },
      },
    },
  });
}

function mountContribRatingChart(p) {
  const buckets = { excellent: 0, good: 0, partial: 0, failed: 0 };
  for (const r of p.runs) for (const s of r.stages) if (buckets[s.rating] != null) buckets[s.rating]++;
  const labels = ['excellent', 'good', 'partial', 'failed'];
  makeChart('contribRatingChart', {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: labels.map((l) => buckets[l]),
        backgroundColor: labels.map((l) => RATING_COLOR[l]),
        borderColor: '#0d121b', borderWidth: 2,
      }],
    },
    options: {
      cutout: '62%',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#d5dde8', font: { size: 11, family: FONT }, boxWidth: 10, boxHeight: 10 } },
        tooltip: COMMON_TOOLTIP,
      },
    },
  });
}

/* ════════════════════════════════════════════════════════════════════════
   Charts
   ════════════════════════════════════════════════════════════════════════ */

// Cache of <img> elements keyed by URL — Chart.js plugins draw synchronously,
// so logos must already be decoded by the time the bubble draws. Images that
// haven't finished loading trigger a single chart update once they do.
const _logoImgCache = new Map();
function _getLogoImg(url, onLoad) {
  if (!url) return null;
  let img = _logoImgCache.get(url);
  if (img) return img;
  img = new Image();
  img.crossOrigin = 'anonymous';
  img._loaded = false;
  img.onload  = () => { img._loaded = true; onLoad && onLoad(); };
  img.onerror = () => { img._broken = true; };
  img.src = url;
  _logoImgCache.set(url, img);
  return img;
}

// Returns an offscreen canvas containing `img` recolored to `tintColor` while
// preserving its alpha. Used to flip the light-grey catalog logos to a dark
// fill when they're placed on a bright tile background. Cached per (img, tint).
const _tintedLogoCache = new Map();
function _tintedLogo(img, tintColor) {
  if (!img || !img._loaded) return null;
  const key = img.src + '|' + tintColor;
  const cached = _tintedLogoCache.get(key);
  if (cached) return cached;
  const w = img.naturalWidth  || 64;
  const h = img.naturalHeight || 64;
  const off = document.createElement('canvas');
  off.width  = w;
  off.height = h;
  const c = off.getContext('2d');
  c.drawImage(img, 0, 0, w, h);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = tintColor;
  c.fillRect(0, 0, w, h);
  _tintedLogoCache.set(key, off);
  return off;
}

// Blend between two #RRGGBB colors in OKLCH (Björn Ottosson's perceptually
// uniform space). Compared to linear-RGB lerp, OKLCH keeps both chroma and
// lightness consistent through the middle, so a cyan → magenta gradient stays
// vivid the whole way instead of dipping through a dull grey-purple.
function _srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function _linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
function _srgbToOklab(r, g, b) {
  const lr = _srgbToLinear(r), lg = _srgbToLinear(g), lb = _srgbToLinear(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}
function _oklabToSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return {
    r: Math.max(0, Math.min(1, _linearToSrgb( 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s))),
    g: Math.max(0, Math.min(1, _linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s))),
    b: Math.max(0, Math.min(1, _linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s))),
  };
}
function _lerpHex(c1, c2, t) {
  t = Math.max(0, Math.min(1, t));
  const r1 = parseInt(c1.slice(1, 3), 16) / 255;
  const g1 = parseInt(c1.slice(3, 5), 16) / 255;
  const b1 = parseInt(c1.slice(5, 7), 16) / 255;
  const r2 = parseInt(c2.slice(1, 3), 16) / 255;
  const g2 = parseInt(c2.slice(3, 5), 16) / 255;
  const b2 = parseInt(c2.slice(5, 7), 16) / 255;
  const lab1 = _srgbToOklab(r1, g1, b1);
  const lab2 = _srgbToOklab(r2, g2, b2);
  // Convert both to OKLCh so we can interpolate hue along the shortest arc
  // (otherwise cyan→magenta could dip through grey at the chroma-zero pole).
  const C1 = Math.hypot(lab1.a, lab1.b);
  const C2 = Math.hypot(lab2.a, lab2.b);
  const h1 = Math.atan2(lab1.b, lab1.a);
  let dh = Math.atan2(lab2.b, lab2.a) - h1;
  if (dh >  Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  const L = lab1.L + (lab2.L - lab1.L) * t;
  const C = C1 + (C2 - C1) * t;
  const h = h1 + dh * t;
  const rgb = _oklabToSrgb(L, C * Math.cos(h), C * Math.sin(h));
  return `rgb(${Math.round(rgb.r * 255)}, ${Math.round(rgb.g * 255)}, ${Math.round(rgb.b * 255)})`;
}

// Trace a rounded-rect path on the given context. roundRect is widely shipped
// (Chrome 99+, Safari 16+, Firefox 113+) but we draw the arcs by hand so older
// browsers don't fall off.
function _roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// Greedy word-wrap to `maxWidth` (in the current ctx font), capped at
// `maxLines`. The last line gets an ellipsis if it would have overflowed.
// Assumes ctx.font is set by the caller.
function _wrapText(ctx, text, maxWidth, maxLines = 2) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const test = current ? current + ' ' + w : w;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = w;
      if (lines.length === maxLines - 1) {
        // We're on the last allowed line — pack the rest in with ellipsis if
        // they don't fit.
        const rest = [w, ...words.slice(i + 1)].join(' ');
        if (ctx.measureText(rest).width <= maxWidth) {
          current = rest;
        } else {
          let truncated = rest;
          while (truncated.length && ctx.measureText(truncated + '…').width > maxWidth) {
            truncated = truncated.slice(0, -1);
          }
          current = truncated + '…';
        }
        break;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function mountScatter() {
  if (!DATA.scatter.length) return;

  // Treemap encoding:
  //   tile area  ← quality (avg rating score, 0–1)
  //   tile color ← cost (log-scaled cyan→red, since costs span ~25×)
  // The treemap plugin handles layout only; the actual fill / logo / label
  // are drawn by a custom plugin so we get rounded corners and a logo.
  const points = DATA.scatter;
  const costs  = points.map((p) => p.x).filter((c) => c > 0);
  const logMin = Math.log(Math.min(...costs));
  const logMax = Math.log(Math.max(...costs));
  const span   = logMax - logMin || 1;
  const colorForCost = (cost) => {
    const t = (Math.log(cost) - logMin) / span;
    return _lerpHex('#5ad1ff', '#ff6ad5', t);   // site cyan → magenta
  };

  // Score is 0–1; scale to ints so tiny scores don't round to 0 area.
  const tree = points.map((p) => ({ ...p, _sz: Math.max(1, Math.round(p.y * 1000)) }));

  // Re-render once any pending logo finishes decoding.
  const requestRedraw = () => {
    const c = _charts.get('scatterChart');
    if (c) c.draw();
  };
  for (const p of tree) _getLogoImg(p.logo, requestRedraw);

  // Custom tile renderer: rounded card, logo top-left, name + metrics inline.
  const tilePlugin = {
    id: 'treemapTiles',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      if (!meta) return;
      const activeIdx = (chart.getActiveElements() || []).map((a) => a.index);

      meta.data.forEach((el, i) => {
        const props = el.getProps(['x', 'y', 'width', 'height'], true);
        const { x, y, width: w, height: h } = props;
        // The treemap layout reorders by area, so the element at index i is
        // not necessarily tree[i]. Read the parsed datum off the dataset.
        const d = chart.data.datasets[0].data[i]?._data;
        if (!d || w < 4 || h < 4) return;
        const active = activeIdx.includes(i);
        const radius = Math.min(8, w / 2, h / 2);

        // Card body.
        ctx.save();
        _roundRectPath(ctx, x, y, w, h, radius);
        ctx.fillStyle = colorForCost(d.x);
        ctx.fill();
        if (active) {
          ctx.strokeStyle = '#0d121b';
          ctx.lineWidth   = 2;
          ctx.stroke();
        }
        ctx.restore();

        // Layout decisions based on tile size.
        const pad      = 8;
        const minSide  = Math.min(w, h);
        const logoSize = Math.max(12, Math.min(30, minSide * 0.30));

        // Logo (top-left), recolored dark so it reads on the bright tile.
        let textX = x + pad;
        const textTop = y + pad;
        const img = _getLogoImg(d.logo, requestRedraw);
        if (img && img._loaded && !img._broken && w > logoSize + pad * 2 && h > logoSize + pad) {
          const tinted = _tintedLogo(img, '#0d121b');
          if (tinted) {
            ctx.save();
            ctx.globalAlpha = 0.92;
            ctx.drawImage(tinted, x + pad, y + pad, logoSize, logoSize);
            ctx.restore();
          }
          textX = x + pad + logoSize + pad;
        }

        // Text block: name on top, "score · spent" below if there's room.
        const haveLogo = textX > x + pad + 1;
        const nameFontSize = haveLogo
          ? Math.max(9, Math.min(12, logoSize * 0.42))
          : Math.max(9, Math.min(13, minSide * 0.16));
        const metricFontSize = Math.max(8, nameFontSize - 2);

        // Available width for the name + metric text block.
        const textWidth = (x + w - pad) - textX;
        if (textWidth < 30) { return; }

        ctx.save();
        // Clip to the tile so anything we measured-but-still-overflows gets
        // cleanly trimmed by the rounded edge.
        _roundRectPath(ctx, x, y, w, h, radius);
        ctx.clip();

        ctx.fillStyle    = '#0d121b';
        ctx.textBaseline = 'top';
        ctx.font         = `600 ${nameFontSize}px ${FONT}`;

        // Wrap the name. Cap at 2 lines to keep tiles legible; the helper
        // adds an ellipsis if even 2 lines aren't enough.
        const name      = d.display_name || d.model;
        const nameLineH = Math.round(nameFontSize * 1.15);
        const nameLines = _wrapText(ctx, name, textWidth, 2);
        const nameTopY  = haveLogo ? y + pad : textTop;
        nameLines.forEach((line, idx) => {
          ctx.fillText(line, textX, nameTopY + idx * nameLineH);
        });

        // Metric line: just the score. (Total spend is reserved for the
        // tooltip — putting it on every tile clutters the visual.)
        const metricTop = nameTopY + nameLines.length * nameLineH + 2;
        if (metricTop + metricFontSize <= y + h - pad) {
          const score = (d.y * 10).toFixed(1);
          ctx.font      = `${metricFontSize}px ${FONT}`;
          ctx.fillStyle = 'rgba(13,18,27,.78)';
          ctx.fillText(score, textX, metricTop);
        }
        ctx.restore();
      });
    },
  };

  makeChart('scatterChart', {
    type: 'treemap',
    data: {
      datasets: [{
        tree,
        key:             '_sz',
        // Hide the built-in fill / label — the plugin above draws the real
        // tile. Keep a transparent backgroundColor so hit detection still
        // covers the tile area.
        backgroundColor: 'rgba(0,0,0,0)',
        borderWidth:     0,
        spacing:         4,
        labels:          { display: false },
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 4, right: 4, bottom: 4, left: 4 } },
      // Make tiles feel like links: pointer cursor on hover, click → model page.
      onHover: (event, elements, chart) => {
        chart.canvas.style.cursor = elements.length ? 'pointer' : 'default';
      },
      onClick: (event, elements, chart) => {
        if (!elements.length) return;
        const e = elements[0];
        // Treemap reorders by area; pull the datum from the dataset rather
        // than indexing into the original `tree` array.
        const d = chart.data.datasets[e.datasetIndex].data[e.index]?._data;
        if (!d) return;
        // Slug = model id with HF-style "org/repo" → "org__repo" so the URL
        // stays one segment. Mirrors _slug_model() in build_site.py.
        const slug = String(d.model).replace(/\//g, '__');
        navigate(`/models/${encodeURIComponent(slug)}/`);
      },
      plugins: {
        legend: { display: false },
        tooltip: { ...COMMON_TOOLTIP,
          callbacks: {
            title: (items) => {
              const d = items[0].raw?._data;
              if (!d) return '';
              const provs = d.providers && d.providers.length
                ? ' · ' + d.providers.join(', ')
                : '';
              return (d.display_name || d.model) + provs;
            },
            label: (ctx) => {
              const d = ctx.raw?._data;
              if (!d) return '';
              const spent = d.total_cost_usd == null ? '—'
                : '$' + (d.total_cost_usd < 1
                  ? d.total_cost_usd.toFixed(4)
                  : d.total_cost_usd.toFixed(2));
              return [
                `score ${(d.y * 10).toFixed(1)}`,
                `total spend ${spent}`,
                `${d.run_count} run${d.run_count === 1 ? '' : 's'}`,
              ];
            },
          },
        },
      },
    },
    plugins: [tilePlugin],
  });
}

function mountActivity(id = 'activityChart') {
  if (!DATA.activity.length) return;
  makeChart(id, {
    type: 'line',
    data: {
      labels: DATA.activity.map((a) => a.date),
      datasets: [{
        data: DATA.activity.map((a) => a.count),
        borderColor: '#5ad1ff',
        backgroundColor: 'rgba(90,209,255,.15)',
        borderWidth: 1.5,
        fill: true, tension: .3,
        pointRadius: 3, pointHoverRadius: 5,
        pointBackgroundColor: '#ff6ad5',
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: COMMON_TOOLTIP },
      scales: {
        x: { ...COMMON_SCALES, ticks: { ...COMMON_SCALES.ticks, maxRotation: 0, autoSkipPadding: 14 } },
        y: { ...COMMON_SCALES, beginAtZero: true, ticks: { ...COMMON_SCALES.ticks, precision: 0 } },
      },
    },
  });
}

function mountLeaderBar(rows) {
  const top = rows.slice(0, 12);
  makeChart('leaderBar', {
    type: 'bar',
    data: {
      labels: top.map((r) => `${r.agent} · ${r.model}`),
      datasets: [{
        data: top.map((r) => r.avg_rating_score || 0),
        backgroundColor: top.map((_, i) => i === 0 ? '#ff6ad5' : 'rgba(90,209,255,.55)'),
        borderColor: top.map((_, i) => i === 0 ? '#ff6ad5' : '#5ad1ff'),
        borderWidth: 1,
        borderRadius: 2,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...COMMON_TOOLTIP, callbacks: { label: (ctx) => `score ${(ctx.raw * 10).toFixed(1)}` } },
      },
      scales: {
        x: { ...COMMON_SCALES, min: 0, max: 1,
             ticks: { ...COMMON_SCALES.ticks, callback: (v) => (v * 10).toFixed(0) } },
        y: { ...COMMON_SCALES, ticks: { ...COMMON_SCALES.ticks, font: { size: 10 } } },
      },
    },
  });
}

// Horizontal bar of avg rating score (0–10) per cross-axis entry. Used by the
// stacks detail page to chart which models rank best on a given tech stack.
function mountCrossBarChart(canvasId, rows, labelKey) {
  if (!rows || !rows.length) return;
  const sorted = [...rows].sort((a, b) => (b.avg_rating_score || 0) - (a.avg_rating_score || 0)).slice(0, 12);
  makeChart(canvasId, {
    type: 'bar',
    data: {
      labels: sorted.map((r) => r[labelKey] || '—'),
      datasets: [{
        data: sorted.map((r) => r.avg_rating_score || 0),
        backgroundColor: sorted.map((_, i) => i === 0 ? '#ff6ad5' : 'rgba(90,209,255,.55)'),
        borderColor: sorted.map((_, i) => i === 0 ? '#ff6ad5' : '#5ad1ff'),
        borderWidth: 1, borderRadius: 2,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...COMMON_TOOLTIP, callbacks: {
          label: (ctx) => {
            const r = sorted[ctx.dataIndex];
            return [`score ${(ctx.raw * 10).toFixed(1)}`, `${r.run_count} run${r.run_count === 1 ? '' : 's'} · ${r.stage_count} stage${r.stage_count === 1 ? '' : 's'}`];
          },
        } },
      },
      scales: {
        x: { ...COMMON_SCALES, min: 0, max: 1,
             ticks: { ...COMMON_SCALES.ticks, callback: (v) => (v * 10).toFixed(0) } },
        y: { ...COMMON_SCALES, ticks: { ...COMMON_SCALES.ticks, font: { size: 10 } } },
      },
    },
  });
}

function mountTestThemeChart(test) {
  // Aggregate stage ratings across all runs in this test
  const buckets = { excellent: 0, good: 0, partial: 0, failed: 0 };
  for (const r of test.runs) for (const s of r.stages) if (buckets[s.rating] != null) buckets[s.rating]++;
  const labels = ['excellent', 'good', 'partial', 'failed'];
  makeChart('testThemeChart', {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: labels.map((l) => buckets[l]),
        backgroundColor: labels.map((l) => RATING_COLOR[l]),
        borderColor: '#0d121b', borderWidth: 2,
      }],
    },
    options: {
      cutout: '62%',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#d5dde8', font: { size: 11, family: FONT }, boxWidth: 10, boxHeight: 10 } },
        tooltip: COMMON_TOOLTIP,
      },
    },
  });
}

function mountRunStageChart(run, test) {
  // Gantt-style horizontal timeline: one stacked bar segment per stage,
  // segment width = duration_sec (or equal if unrecorded), fill = rating color.
  const stages = run.stages;
  const totalDur = stages.reduce((a, s) => a + (s.duration_sec || 0), 0);
  const useDur = totalDur > 0;
  const datasets = stages.map((s, i) => ({
    label: `${String(i + 1).padStart(2, '0')} · ${s.id}`,
    data: [useDur ? (s.duration_sec || 0) : 1],
    backgroundColor: RATING_COLOR[s.rating],
    borderColor: '#0d121b',
    borderWidth: 2,
    borderRadius: 2,
    barPercentage: 0.85,
    categoryPercentage: 1.0,
  }));
  makeChart('runStageChart', {
    type: 'bar',
    data: { labels: ['timeline'], datasets },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...COMMON_TOOLTIP, callbacks: {
          title: (items) => stages[items[0].datasetIndex].id,
          label: (ctx) => {
            const s = stages[ctx.datasetIndex];
            const score = ((RATING_SCORE[s.rating] ?? 0) * 10).toFixed(1);
            return [
              `${s.rating} · score ${score}`,
              useDur ? fmtDuration(s.duration_sec || 0) : 'duration unrecorded',
            ];
          },
        } },
      },
      scales: {
        x: { ...COMMON_SCALES, stacked: true,
          ticks: useDur ? { ...COMMON_SCALES.ticks, callback: (v) => fmtDuration(v) } : { display: false },
          grid: useDur ? COMMON_SCALES.grid : { display: false } },
        y: { ...COMMON_SCALES, stacked: true, display: false },
      },
    },
  });
}

function mountRunMetricChart(run) {
  const labels = run.stages.map((s) => s.id);
  makeChart('runMetricChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'duration (s)', data: run.stages.map((s) => s.duration_sec || 0),
          backgroundColor: 'rgba(90,209,255,.55)', borderColor: '#5ad1ff', borderWidth: 1,
          borderRadius: 2, yAxisID: 'y' },
        { label: 'cost ($)', data: run.stages.map((s) => s.cost_usd || 0),
          backgroundColor: 'rgba(255,106,213,.55)', borderColor: '#ff6ad5', borderWidth: 1,
          borderRadius: 2, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#d5dde8', font: { family: FONT, size: 11 } } },
        tooltip: COMMON_TOOLTIP,
      },
      scales: {
        x: COMMON_SCALES,
        y:  { ...COMMON_SCALES, position: 'left',  title: { display: true, text: 'sec', color: '#5ad1ff', font: { size: 10 } } },
        y1: { ...COMMON_SCALES, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '$', color: '#ff6ad5', font: { size: 10 } } },
      },
    },
  });
}

/* ════════════════════════════════════════════════════════════════════════
   Keyboard shortcuts + help modal
   ════════════════════════════════════════════════════════════════════════ */
const NAV_BY_KEY = { '1': '/', '2': '/leaderboard/', '3': '/tests/', '4': '/runs/', '5': '/contributors/', '6': '/hardware/' };
let _gPrefix = false, _gTimer = null;

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const help = $('#helpModal');

  if (e.key === '?' || (e.shiftKey && e.key === '/')) {
    help.hidden = !help.hidden; e.preventDefault(); return;
  }
  if (e.key === 'Escape') {
    if (!help.hidden) { help.hidden = true; return; }
    if (location.pathname !== '/') history.back();
    return;
  }
  if (NAV_BY_KEY[e.key]) { navigate(NAV_BY_KEY[e.key]); e.preventDefault(); return; }

  if (e.key === 'g') {
    _gPrefix = true;
    clearTimeout(_gTimer);
    _gTimer = setTimeout(() => { _gPrefix = false; }, 700);
    return;
  }
  if (_gPrefix && e.key === 'h') {
    navigate('/'); _gPrefix = false; e.preventDefault(); return;
  }

  const main = $('#main');
  if (e.key === 'j') { main.scrollBy({ top: 60, behavior: 'smooth' }); e.preventDefault(); }
  if (e.key === 'k') { main.scrollBy({ top: -60, behavior: 'smooth' }); e.preventDefault(); }
});

$('#helpClose').addEventListener('click', () => { $('#helpModal').hidden = true; });
$('#helpModal').addEventListener('click', (e) => { if (e.target.id === 'helpModal') e.currentTarget.hidden = true; });

/* ════════════════════════════════════════════════════════════════════════
   Mobile drawer (sidebar toggle on narrow screens)
   ════════════════════════════════════════════════════════════════════════ */
function setNavOpen(open) {
  document.body.classList.toggle('nav-open', open);
  $('#hamburger')?.setAttribute('aria-expanded', open ? 'true' : 'false');
}
$('#hamburger')?.addEventListener('click', () => {
  setNavOpen(!document.body.classList.contains('nav-open'));
});
$('#navBackdrop')?.addEventListener('click', () => setNavOpen(false));
// Close the drawer whenever the user picks a sidebar entry.
$('#navList')?.addEventListener('click', (e) => {
  if (e.target.closest('.nav-item')) setNavOpen(false);
});
// Esc closes the drawer (in addition to its existing back/close behavior).
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('nav-open')) setNavOpen(false);
});

/* ════════════════════════════════════════════════════════════════════════
   Boot
   ════════════════════════════════════════════════════════════════════════ */
mountRatingScale();
route();
