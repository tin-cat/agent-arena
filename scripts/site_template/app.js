/* ═══════════════════════════════════════════════════════════════════════════
   AgentArena dashboard — terminal-themed SPA
   ═══════════════════════════════════════════════════════════════════════════ */

const DATA = JSON.parse(document.getElementById('bootData').textContent);
const RATING_COLOR = DATA.rating_color || {
  excellent: '#34d399', good: '#a7f3d0', partial: '#fbbf24', failed: '#f87171',
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
const statusRoute = () => $('#statusRoute');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoney = (v) => v == null ? '—' : '$' + Number(v).toFixed(2);
const fmtNum   = (v) => v == null ? '—' : new Intl.NumberFormat().format(v);
const fmtPct   = (v) => v == null ? '—' : Math.round(v * 100) + '%';
const fmtScore = (v) => v == null ? '—' : Number(v).toFixed(2);

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
const loadRuns        = ()         => loadJSON('runs.json').then((d) => d.runs);
const loadTest        = (name)     => loadJSON(`tests/${encodeURIComponent(name)}.json`);
const loadRun         = (t, id)    => loadJSON(`runs/${encodeURIComponent(t)}/${encodeURIComponent(id)}.json`);
const loadContributor = (handle)   => loadJSON(`contributors/${encodeURIComponent(handle)}.json`);
const loadAgent       = (id)       => loadJSON(`agents/${encodeURIComponent(id)}.json`);
const loadProvider    = (id)       => loadJSON(`providers/${encodeURIComponent(id)}.json`);

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
const routes = [
  { pat: /^\/?$|^\/overview$/,                          name: 'overview',     handler: (_m, gen) => renderOverview(gen) },
  { pat: /^\/leaderboard$/,                             name: 'leaderboard',  handler: (_m, gen) => renderLeaderboard(gen) },
  { pat: /^\/tests$/,                                   name: 'tests',        handler: (_m, gen) => renderTests(null, gen) },
  { pat: /^\/tests\/([^/]+)$/,                          name: 'tests',        handler: (m, gen) => renderTests(m[1], gen) },
  { pat: /^\/tests\/([^/]+)\/runs\/([^/]+)$/,           name: 'tests',        handler: (m, gen) => renderRunDetail(m[1], m[2], 'tests', gen) },
  { pat: /^\/runs$/,                                    name: 'runs',         handler: (_m, gen) => renderRuns(gen) },
  { pat: /^\/runs\/([^/]+)\/([^/]+)$/,                  name: 'runs',         handler: (m, gen) => renderRunDetail(m[1], m[2], 'runs', gen) },
  { pat: /^\/contributors$/,                            name: 'contributors', handler: (_m, gen) => renderContributors(gen) },
  { pat: /^\/contributors\/([^/]+)$/,                   name: 'contributors', handler: (m, gen) => renderContributorProfile(decodeURIComponent(m[1]), gen) },
  { pat: /^\/agents$/,                                  name: 'agents',       handler: (_m, gen) => renderAgents(null, gen) },
  { pat: /^\/agents\/([^/]+)$/,                         name: 'agents',       handler: (m, gen) => renderAgents(decodeURIComponent(m[1]), gen) },
  { pat: /^\/providers$/,                               name: 'providers',    handler: (_m, gen) => renderProviders(null, gen) },
  { pat: /^\/providers\/([^/]+)$/,                      name: 'providers',    handler: (m, gen) => renderProviders(decodeURIComponent(m[1]), gen) },
  { pat: /^\/hardware$/,                                name: 'hardware',     handler: (_m, gen) => renderHardware(gen) },
];

function parseHash() {
  const h = (location.hash || '#/overview').replace(/^#/, '');
  return h || '/overview';
}

// Each route() call gets a monotonically-increasing token. Async handlers check
// `currentGen()` before mutating the DOM to avoid stale renders when the user
// navigates again before a fetch resolves.
let _routeGen = 0;
const currentGen = () => _routeGen;
const isStale = (gen) => gen !== _routeGen;

async function route() {
  const gen = ++_routeGen;
  destroyAllCharts();
  const path = parseHash();
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
  statusRoute().textContent = '▌ ' + name;
}

window.addEventListener('hashchange', route);

// Clicking a nav link whose href matches the current hash doesn't fire
// hashchange, so the view never re-renders. Force a re-route in that case.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a) return;
  if (a.getAttribute('href') === location.hash) {
    e.preventDefault();
    route();
  }
});

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

  view().innerHTML = `
    ${heroHTML()}

    <div class="metric-grid">
      <div class="metric cy"><div class="label">tests</div><div class="value">${s.tests}</div><div class="sub">community-defined</div></div>
      <div class="metric"><div class="label">runs</div><div class="value">${s.runs}</div><div class="sub">contributed</div></div>
      <div class="metric"><div class="label">stages</div><div class="value">${s.stages}</div><div class="sub">executed</div></div>
      <div class="metric"><div class="label">models</div><div class="value">${s.models}</div><div class="sub">provider · model combos</div></div>
      <div class="metric alt"><div class="label">contributors</div><div class="value">${s.contributors}</div><div class="sub">unique runners</div></div>
    </div>

    <div class="split-2">
      <div class="panel">
        <div class="panel-head"><span class="panel-title">cost vs quality</span><span class="panel-actions t-mute">${DATA.scatter.length} model${DATA.scatter.length === 1 ? '' : 's'} · bubble = run count</span></div>
        <div class="panel-body"><div class="chart-box"><canvas id="scatterChart"></canvas></div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><span class="panel-title alt">runs over time</span><span class="panel-actions t-mute">${DATA.activity.length} days</span></div>
        <div class="panel-body"><div class="chart-box"><canvas id="activityChart"></canvas></div></div>
      </div>
    </div>

    <div class="split-2">
      <div class="panel">
        <div class="panel-head"><span class="panel-title">top of the leaderboard</span><a class="t-cyan" href="#/leaderboard">view all →</a></div>
        <div class="panel-body dense">${overviewLeaderHTML(DATA.leaderboard.slice(0, 5))}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><span class="panel-title">latest contributions</span><a class="t-cyan" href="#/contributors">all contributors →</a></div>
        <div class="panel-body dense"><div class="feed">${recent.slice(0, 6).map(feedItemHTML).join('') || '<div style="padding:14px;color:var(--text-mute)">none yet.</div>'}</div></div>
      </div>
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
  `;

  mountScatter();
  mountActivity();
}

function heroHTML() {
  const tagline = DATA.tagline || 'Community contributed benchmarks of agentic AI coding setups';
  return `
    <section class="hero-panel">
      <div class="hero-grid">
        <div class="hero-main">
          <div class="hero-eyebrow">▌ welcome</div>
          <h1 class="hero-title">${esc(tagline)}.</h1>
          <p class="hero-lead">Live rankings for every model, agent, rig, and contributor in the arena so far. Browse the board, drill into runs, peek at the silicon — then add your own to claim a slot.</p>
          <div class="hero-ctas">
            <a class="cta cta-primary" href="#/leaderboard">→ see the leaderboard</a>
            <a class="cta" href="${esc(DATA.github_url)}/blob/main/CONTRIBUTING.md" rel="noopener">+ contribute your tests</a>
          </div>
        </div>
        <aside class="hero-side">
          <div class="hero-eyebrow">rating scale</div>
          <ul class="legend">
            <li><span class="dot" style="background:${RATING_COLOR.excellent}"></span><span class="lg-label">excellent</span><span class="lg-score">1.00</span><span class="lg-blurb">clean one-shot</span></li>
            <li><span class="dot" style="background:${RATING_COLOR.good}"></span><span class="lg-label">good</span><span class="lg-score">0.75</span><span class="lg-blurb">minor follow-up</span></li>
            <li><span class="dot" style="background:${RATING_COLOR.partial}"></span><span class="lg-label">partial</span><span class="lg-score">0.40</span><span class="lg-blurb">major gaps</span></li>
            <li><span class="dot" style="background:${RATING_COLOR.failed}"></span><span class="lg-label">failed</span><span class="lg-score">0.00</span><span class="lg-blurb">could not complete</span></li>
          </ul>
        </aside>
      </div>
    </section>
  `;
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
  return `<div class="feed-item">
    <span class="glyph">▸</span>
    <span><a href="#/contributors/${encodeURIComponent(c.handle)}">${esc(c.handle)}</a> <span class="who">ran</span> <a href="#/tests/${esc(c.test_name)}/runs/${esc(c.run_id)}">${esc(c.test_name)}</a> <span class="who">on</span> ${esc(c.agent)}/${esc(c.model)}</span>
    <span class="meta">${esc(c.date)}</span>
  </div>`;
}

/* ─────────────────────────── 02 · LEADERBOARD ─────────────────────────── */
function renderLeaderboard() {
  const rows = DATA.leaderboard;

  view().innerHTML = `
    ${viewHead('leaderboard', '02', 'Aggregated across every contributed stage. Ranked by average rating score (excellent = 1.0, good = 0.75, partial = 0.4, failed = 0.0).')}

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
        <td>${esc(r.agent)}</td>
        <td><span class="pill muted">${esc(r.provider)}</span></td>
        <td><b>${esc(r.model)}</b></td>
        <td style="min-width:200px">${bar(r.avg_rating_score)}</td>
        <td class="num">${fmtPct(r.success_rate)}</td>
        <td class="num">${r.run_count}</td>
        <td class="num">${r.stage_count}</td>
        <td class="num">${fmtMoney(r.avg_cost_per_stage)}</td>
        <td class="num">${fmtDuration(r.avg_duration_sec)}</td>
        <td class="num">${r.rating_per_dollar == null ? '—' : Number(r.rating_per_dollar).toFixed(2)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

/* ────────────────────────────── 03 · TESTS ────────────────────────────── */
async function renderTests(selectedName, gen) {
  const tests = DATA.tests;
  const selected = tests.find((t) => t.name === selectedName) || tests[0];

  // Master list renders synchronously from the index. The detail slot shows a
  // skeleton, then swaps in once `tests/<name>.json` resolves.
  view().innerHTML = `
    ${viewHead('tests', '03', 'Browse community-defined tests, their stage prompts, and the runs contributed against each.')}

    <div class="master-detail">
      <div class="panel" style="margin-bottom:0">
        <div class="panel-head"><span class="panel-title">${tests.length} tests</span></div>
        <div class="panel-body dense">
          <div class="test-list">${tests.map((t) => testListItemHTML(t, selected && t.name === selected.name)).join('')}</div>
        </div>
      </div>
      <div id="testDetailSlot">${selected ? SKELETON : '<div class="panel"><div class="panel-body t-mute">no tests yet.</div></div>'}</div>
    </div>
  `;
  if (!selected) return;

  try {
    const test = await loadTest(selected.name);
    if (isStale(gen)) return;
    const slot = $('#testDetailSlot');
    if (slot) slot.innerHTML = testDetailHTML(test);
    mountTestThemeChart(test);
  } catch (err) {
    if (isStale(gen)) return;
    const slot = $('#testDetailSlot');
    if (slot) slot.innerHTML = errorPanelHTML(err);
  }
}

function testListItemHTML(t, isActive) {
  return `<a class="test-list-item ${isActive ? 'active' : ''}" href="#/tests/${esc(t.name)}">
    <div class="name">${esc(t.name)}${t.domain ? ` · ${esc(t.domain)}` : ''}</div>
    <div class="title">${esc(t.title)}</div>
    <div class="meta">${t.run_count} run${t.run_count === 1 ? '' : 's'} · ${t.stages_total} stage${t.stages_total === 1 ? '' : 's'}${t.top_score != null ? ` · top ${fmtScore(t.top_score)}` : ''}${t.contributor_handle ? ` · by ${esc(t.contributor_handle)}` : ''}</div>
  </a>`;
}

function testDetailHTML(t) {
  return `
    <div class="crumbs">
      <a href="#/tests">tests</a><span class="sep">/</span><span class="cur">${esc(t.name)}</span>
    </div>
    <div class="panel">
      <div class="panel-head">
        <span class="panel-title">${esc(t.title)}</span>
        <span class="panel-actions">
          ${t.domain ? `<span class="pill">${esc(t.domain)}</span>` : ''}
          <span class="pill muted">${esc(t.name)}</span>
        </span>
      </div>
      <div class="panel-body">
        <p style="margin:0 0 16px; color:var(--text-dim)">${esc(t.description)}</p>
        <div class="kv-grid">
          ${t.contributor_handle ? `<div><span class="k">authored by</span><span class="v"><a href="#/contributors/${encodeURIComponent(t.contributor_handle)}">${esc(t.contributor_handle)}</a></span></div>` : ''}
          <div><span class="k">stages</span><span class="v">${t.stages_total}</span></div>
          <div><span class="k">contributed runs</span><span class="v">${t.run_count}</span></div>
          <div><span class="k">top score</span><span class="v t-cyan">${fmtScore(t.runs[0]?.avg_rating_score)}</span></div>
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
        <div class="panel-body dense">${runsTableHTML(t.runs, { showTest: false, linkBase: `#/tests/${t.name}/runs/` })}</div>
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
    tag:        '06',
    title:      'coding agents',
    lead:       'Per-agent breakdown of contributed runs, with the providers used alongside each.',
    crumb:      'agents',
    eyebrow:    'coding agent',
    countSing:  'agent',
    countPlur:  'agents',
    crossLabel: 'providers used',
    crossKey:   'provider',
  },
  providers: {
    list:       () => DATA.providers || [],
    load:       (id) => loadProvider(id),
    route:      'providers',
    routeOther: 'agents',
    tag:        '07',
    title:      'inference providers',
    lead:       'Per-provider breakdown of contributed runs, with the agents observed against each.',
    crumb:      'providers',
    eyebrow:    'inference provider',
    countSing:  'provider',
    countPlur:  'providers',
    crossLabel: 'agents used',
    crossKey:   'agent',
  },
};

function catalogTabHTML(kind, item, isActive) {
  return `<a class="catalog-tab ${isActive ? 'active' : ''}" href="#/${kind.route}/${encodeURIComponent(item.id)}">
    <div class="catalog-tab-head">
      <div class="catalog-tab-name">${esc(item.name || item.id)}${!item.in_catalog ? ' <span class="pill muted">unlisted</span>' : ''}</div>
      ${item.category ? `<div class="catalog-tab-type">${esc(item.category)}</div>` : ''}
    </div>
    <div class="catalog-tab-badges">
      <span class="catalog-tab-badge">${item.run_count} run${item.run_count === 1 ? '' : 's'}</span>
      <span class="catalog-tab-badge">${item.test_count} test${item.test_count === 1 ? '' : 's'}</span>
      ${item.avg_rating_score != null ? `<span class="catalog-tab-badge">top ${fmtScore(item.avg_rating_score)}</span>` : ''}
    </div>
  </a>`;
}

function catalogDetailHTML(kind, d) {
  const logoHTML = d.logo
    ? `<img class="catalog-logo" src=".${esc(d.logo)}" alt="${esc(d.name)} logo" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'catalog-logo fallback',textContent:'▌'}))" />`
    : `<span class="catalog-logo fallback">▌</span>`;

  const crossRows = d.cross.map((c) => `
    <tr class="clickable" onclick="location.hash='#/${kind.routeOther}/${encodeURIComponent(c[kind.crossKey])}'">
      <td><a href="#/${kind.routeOther}/${encodeURIComponent(c[kind.crossKey])}"><code>${esc(c[kind.crossKey])}</code></a></td>
      <td class="num">${c.run_count}</td>
      <td class="num">${c.stage_count}</td>
      <td style="min-width:170px">${bar(c.avg_rating_score)}</td>
    </tr>`).join('');

  const testRows = d.tests.map((t) => `
    <tr class="clickable" onclick="location.hash='#/tests/${encodeURIComponent(t.test_name)}'">
      <td><a href="#/tests/${encodeURIComponent(t.test_name)}">${esc(t.test_name)}</a></td>
      <td class="t-mute">${esc(t.test_title)}</td>
      <td class="num">${t.run_count}</td>
      <td class="num">${t.stage_count}</td>
      <td style="min-width:170px">${bar(t.avg_rating_score)}</td>
    </tr>`).join('');

  return `
    <div class="crumbs">
      <a href="#/${kind.route}">${esc(kind.crumb)}</a><span class="sep">/</span><span class="cur">${esc(d.id)}</span>
    </div>

    <section class="catalog-hero">
      <div class="catalog-hero-logo">${logoHTML}</div>
      <div class="catalog-hero-main">
        <div class="profile-eyebrow t-mute">▌ ${esc(kind.eyebrow)}</div>
        <h1 class="profile-handle">${esc(d.name || d.id)}</h1>
        ${d.description ? `<p class="catalog-hero-desc t-mute">${esc(d.description)}</p>` : ''}
        <div class="catalog-hero-meta">
          ${d.category ? `<span class="pill">${esc(d.category)}</span>` : ''}
          <span class="pill muted">id: ${esc(d.id)}</span>
          ${d.homepage ? `<a class="profile-link" href="${esc(d.homepage)}" rel="noopener">${esc(d.homepage)}</a>` : ''}
          ${!d.in_catalog ? `<span class="pill muted">unlisted — add to /${esc(kind.route)}.json</span>` : ''}
        </div>
        ${d.top_combo ? `<div class="profile-meta">top combo: <b>${esc(d.top_combo)}</b></div>` : ''}
      </div>
      <div class="profile-stats">
        <div class="profile-stat"><span class="k">runs</span><span class="v">${d.run_count}</span></div>
        <div class="profile-stat"><span class="k">stages</span><span class="v">${d.stage_count}</span></div>
        <div class="profile-stat"><span class="k">tests</span><span class="v">${d.test_count}</span></div>
        <div class="profile-stat"><span class="k">contributors</span><span class="v">${d.contributor_count}</span></div>
        <div class="profile-stat"><span class="k">avg score</span><span class="v t-cyan">${fmtScore(d.avg_rating_score)}</span></div>
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

    <div class="panel">
      <div class="panel-head"><span class="panel-title">contributed runs</span><span class="panel-actions t-mute">${d.runs.length} run${d.runs.length === 1 ? '' : 's'}</span></div>
      <div class="panel-body dense">${runsTableHTML(d.runs, { showTest: true })}</div>
    </div>
  `;
}

async function renderCatalog(kind, selectedId, gen) {
  const items = kind.list();
  const selected = items.find((x) => x.id === selectedId) || items[0];

  view().innerHTML = `
    ${viewHead(kind.title, kind.tag, kind.lead)}

    <nav class="catalog-tabs" aria-label="${esc(kind.countPlur)}">
      ${items.map((x) => catalogTabHTML(kind, x, selected && x.id === selected.id)).join('')}
    </nav>
    <div id="catalogDetailSlot">${selected ? SKELETON : '<div class="panel"><div class="panel-body t-mute">no entries yet.</div></div>'}</div>
  `;
  if (!selected) return;

  try {
    const detail = await kind.load(selected.id);
    if (isStale(gen)) return;
    const slot = $('#catalogDetailSlot');
    if (slot) slot.innerHTML = catalogDetailHTML(kind, detail);
  } catch (err) {
    if (isStale(gen)) return;
    const slot = $('#catalogDetailSlot');
    if (slot) slot.innerHTML = errorPanelHTML(err);
  }
}

const renderAgents    = (id, gen) => renderCatalog(CATALOG_KINDS.agents, id, gen);
const renderProviders = (id, gen) => renderCatalog(CATALOG_KINDS.providers, id, gen);

function runsTableHTML(runs, opts = {}) {
  const { showTest = true, linkBase = '#/runs/' } = opts;
  if (!runs.length) return '<div style="padding:14px;color:var(--text-mute)">no runs yet.</div>';
  return `<table>
    <thead><tr>
      ${showTest ? '<th>test</th>' : ''}
      <th>run</th><th>contributor</th><th>agent · model</th>
      <th>stages</th><th>score</th>
      <th class="num">cost</th><th class="num">time</th><th class="num">date</th>
    </tr></thead>
    <tbody>${runs.map((r) => `
      <tr class="clickable" onclick="location.hash='#/tests/${esc(r.test_name)}/runs/${esc(r.run_id)}'">
        ${showTest ? `<td><a href="#/tests/${esc(r.test_name)}">${esc(r.test_name)}</a></td>` : ''}
        <td><a href="#/tests/${esc(r.test_name)}/runs/${esc(r.run_id)}"><code>${esc(r.run_id)}</code></a></td>
        <td><a href="${esc(r.contributor_url)}" rel="noopener">${esc(r.contributor_handle)}</a></td>
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
      <a href="#/${esc(parentRoute || 'tests')}">${esc(parentRoute === 'runs' ? 'all runs' : 'tests')}</a><span class="sep">/</span>
      <a href="#/tests/${esc(testName)}">${esc(testName)}</a><span class="sep">/</span>
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

  const back = parentRoute === 'runs' ? '#/runs' : `#/tests/${testName}`;
  const backLabel = parentRoute === 'runs' ? 'all runs' : test.name;
  const settings = run.settings && Object.keys(run.settings).length ? run.settings : null;
  const hw = run.hardware;

  view().innerHTML = `
    <div class="crumbs">
      <a href="${esc(back)}">${esc(backLabel)}</a><span class="sep">/</span>
      <a href="#/tests/${esc(testName)}">${esc(testName)}</a><span class="sep">/</span>
      <span class="cur">${esc(runId)}</span>
    </div>

    ${viewHead(run.run_id, `${esc(run.agent)} · ${esc(run.model)}`, '')}

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
            <div><span class="k">contributor</span><span class="v"><a href="${esc(run.contributor_url)}" rel="noopener">${esc(run.contributor_handle)}</a></span></div>
            <div><span class="k">date</span><span class="v">${esc(run.date)}</span></div>
            <div><span class="k">agent</span><span class="v">${esc(run.agent)}${run.agent_plan ? ` <span class="t-mute">· ${esc(run.agent_plan)}</span>` : ''}</span></div>
            <div><span class="k">model</span><span class="v">${esc(run.model)}</span></div>
            <div><span class="k">avg score</span><span class="v t-cyan">${fmtScore(run.avg_rating_score)}</span></div>
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
        <td><b>${esc(s.id)}</b></td>
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
  return `<ul class="contrib-rank">${rows.map((r) => `
    <li>
      <a class="contrib-row" href="#/contributors/${encodeURIComponent(r.handle)}">
        <span class="contrib-rank-n${r.rank === 1 ? ' top' : ''}">#${r.rank}</span>
        ${avatarThumb(r, 36)}
        <div class="contrib-id">
          <div class="handle">${esc(r.handle)}</div>
          <div class="sub">${r.top_combo ? esc(r.top_combo) + ' · ' : ''}active until ${fmtDate(r.latest_date)}</div>
        </div>
        <div class="contrib-nums">
          <div><b>${r.run_count}</b><span>runs</span></div>
          <div><b>${r.stage_count}</b><span>stages</span></div>
          <div><b>${r.test_count}</b><span>tests</span></div>
        </div>
        <div class="contrib-score">${bar(r.avg_rating_score)}</div>
      </a>
    </li>`).join('')}</ul>`;
}

function recentContribHTML(rows) {
  if (!rows.length) return '<div style="padding:14px;color:var(--text-mute)">none yet.</div>';
  return `<table>
    <thead><tr><th>date</th><th>handle</th><th>test · run</th><th>agent · model</th></tr></thead>
    <tbody>${rows.map((c) => `
      <tr class="clickable" onclick="location.hash='#/tests/${esc(c.test_name)}/runs/${esc(c.run_id)}'">
        <td class="t-mute">${esc(c.date)}</td>
        <td><a href="#/contributors/${encodeURIComponent(c.handle)}">${esc(c.handle)}</a></td>
        <td><a href="#/tests/${esc(c.test_name)}">${esc(c.test_name)}</a> · <code>${esc(c.run_id)}</code></td>
        <td>${esc(c.agent)} · <b>${esc(c.model)}</b> <span class="pill muted">${esc(c.provider)}</span></td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

/* ────────────────────── contributor profile (sub-route) ────────────────────── */
async function renderContributorProfile(handle, gen) {
  view().innerHTML = `
    <div class="crumbs">
      <a href="#/contributors">contributors</a><span class="sep">/</span><span class="cur">${esc(handle)}</span>
    </div>
    ${SKELETON}
  `;
  let p;
  try {
    p = await loadContributor(handle);
  } catch (err) {
    if (isStale(gen)) return;
    view().innerHTML = `<div class="crumbs"><a href="#/contributors">contributors</a><span class="sep">/</span><span class="cur">${esc(handle)}</span></div>${errorPanelHTML(err)}`;
    return;
  }
  if (isStale(gen)) return;
  if (!p) {
    view().innerHTML = `<div class="crumbs"><a href="#/contributors">contributors</a><span class="sep">/</span><span class="cur">${esc(handle)}</span></div>
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
      <a href="#/contributors">contributors</a><span class="sep">/</span><span class="cur">${esc(p.handle)}</span>
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
          <div class="profile-stat"><div class="k">avg score</div><div class="v t-cyan">${fmtScore(p.avg_rating_score)}</div></div>
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
              <tr class="clickable" onclick="location.hash='#/tests/${esc(t.name)}'">
                <td><a href="#/tests/${esc(t.name)}">${esc(t.title)}</a> <span class="pill muted">${esc(t.name)}</span></td>
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
                <tr class="clickable" onclick="location.hash='#/tests/${esc(t.name)}'">
                  <td><a href="#/tests/${esc(t.name)}">${esc(t.title)}</a> <span class="pill muted">${esc(t.name)}</span></td>
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

/* ─────────────────────────── 06 · SILICON BEASTS ─────────────────────────── */
function renderHardware() {
  const h = DATA.hardware || { headline: { devices: 0, vram_gb: 0, ram_gb: 0, contributors: 0, runs: 0, stages: 0 }, combos: [], by_device: [], by_gpu: [], contributors: [] };
  const hd = h.headline;

  view().innerHTML = `
    ${viewHead('silicon beasts', '08', 'A roll-call of the self-hosted rigs powering local inference in this benchmark. Speed, hardware, and the contributors who threw silicon at the problem.')}

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
          <a class="cta cta-primary" href="${esc(DATA.github_url)}/blob/main/CONTRIBUTING.md" rel="noopener">+ contribute a self-hosted run</a>
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
  return `<table>
    <thead><tr>
      <th class="rank">#</th>
      <th>device · gpu</th>
      <th>model</th>
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
        <td>${esc(r.model)}${r.quantization ? ` <span class="pill muted">${esc(r.quantization)}</span>` : ''}</td>
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
      <a class="contrib-row" href="#/contributors/${encodeURIComponent(r.handle)}">
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
                ? [`${ctx.raw.toFixed(1)} tok/s`, `${r.stage_count} stages · score ${(r.avg_rating_score ?? 0).toFixed(2)}`]
                : [`${fmtDuration(ctx.raw)} avg`, `${r.stage_count} stages · score ${(r.avg_rating_score ?? 0).toFixed(2)}`];
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

function mountScatter() {
  if (!DATA.scatter.length) return;

  // Bubble size encodes total runs (more runs = more confidence in the point).
  const maxRuns = DATA.scatter.reduce((m, p) => Math.max(m, p.run_count), 1);
  const radius  = (n) => 6 + Math.round((n / maxRuns) * 12);  // 6 .. 18
  const data = DATA.scatter.map((p) => ({ ...p, r: radius(p.run_count) }));

  makeChart('scatterChart', {
    type: 'bubble',
    data: {
      datasets: [{
        data,
        backgroundColor:      'rgba(90,209,255,.45)',
        borderColor:          '#5ad1ff',
        borderWidth:          1.5,
        hoverBackgroundColor: 'rgba(90,209,255,.75)',
        hoverBorderColor:     '#ff6ad5',
        hoverBorderWidth:     2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...COMMON_TOOLTIP,
          callbacks: {
            title: (items) => items[0].raw.model,
            label: (ctx) => {
              const p = ctx.raw;
              return [
                `score ${p.y.toFixed(2)} · $${p.x < 1 ? p.x.toFixed(4) : p.x.toFixed(2)} / stage`,
                `${p.run_count} run${p.run_count === 1 ? '' : 's'} · ${p.stage_count} stage${p.stage_count === 1 ? '' : 's'} · ${p.test_count} test${p.test_count === 1 ? '' : 's'}`,
                p.providers.length > 1 ? `via ${p.providers.join(', ')}` : `via ${p.providers[0]}`,
              ];
            },
          },
        },
      },
      scales: {
        x: { ...COMMON_SCALES,
             title: { display: true, text: 'avg cost / stage (USD)', color: '#5d6878', font: { size: 10 } },
             ticks: { ...COMMON_SCALES.ticks, callback: (v) => '$' + (v < 1 ? v.toFixed(2) : v) } },
        y: { ...COMMON_SCALES, min: 0, max: 1,
             title: { display: true, text: 'avg rating score', color: '#5d6878', font: { size: 10 } } },
      },
    },
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
        tooltip: { ...COMMON_TOOLTIP, callbacks: { label: (ctx) => `score ${ctx.raw.toFixed(2)}` } },
      },
      scales: {
        x: { ...COMMON_SCALES, min: 0, max: 1 },
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
  // line of rating-score across stages (0..1)
  const labels = run.stages.map((s) => s.id);
  const data = run.stages.map((s) => RATING_SCORE[s.rating] ?? 0);
  makeChart('runStageChart', {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data, borderColor: '#5ad1ff', backgroundColor: 'rgba(90,209,255,.18)',
        borderWidth: 2, fill: true, tension: .25,
        pointBackgroundColor: run.stages.map((s) => RATING_COLOR[s.rating]),
        pointBorderColor: '#0d121b', pointBorderWidth: 1.5,
        pointRadius: 6, pointHoverRadius: 8,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...COMMON_TOOLTIP, callbacks: {
          title: (items) => labels[items[0].dataIndex],
          label: (ctx) => `${run.stages[ctx.dataIndex].rating} · score ${ctx.raw.toFixed(2)}`,
        } },
      },
      scales: {
        x: COMMON_SCALES,
        y: { ...COMMON_SCALES, min: 0, max: 1 },
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
const NAV_BY_KEY = { '1': '#/overview', '2': '#/leaderboard', '3': '#/tests', '4': '#/runs', '5': '#/contributors', '6': '#/hardware' };
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
    if (location.hash && location.hash !== '#/overview') history.back();
    return;
  }
  if (NAV_BY_KEY[e.key]) { location.hash = NAV_BY_KEY[e.key]; e.preventDefault(); return; }

  if (e.key === 'g') {
    _gPrefix = true;
    clearTimeout(_gTimer);
    _gTimer = setTimeout(() => { _gPrefix = false; }, 700);
    return;
  }
  if (_gPrefix && e.key === 'h') {
    location.hash = '#/overview'; _gPrefix = false; e.preventDefault(); return;
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
// replaceState (rather than assigning to location.hash) avoids firing an extra
// hashchange and prevents a junk history entry on first load.
if (!location.hash || location.hash === '#') {
  history.replaceState(null, '', '#/overview');
}
route();
