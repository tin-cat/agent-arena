const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_LEN = 4096;
const PAGE_SIZE = 50;
const TEN_MIN_MS = 1 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

const messages = []; // sorted newest-first
const clients = new Set();
const rateLimits = new Map(); // ip -> lastPostTimestamp

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie;
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx < 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    try { cookies[key] = decodeURIComponent(val); } catch (_) { cookies[key] = val; }
  }
  return cookies;
}

app.use(express.json({ limit: '16kb' }));

// Issue CSRF token + user ID cookies for new visitors
app.use((req, res, next) => {
  const cookies = parseCookies(req);
  const setCookies = [];

  // CSRF: not HttpOnly so client JS can read it
  if (!cookies.wallCsrfToken) {
    const token = crypto.randomBytes(32).toString('hex');
    setCookies.push(`wallCsrfToken=${token}; SameSite=Strict; Path=/`);
    req.csrfToken = undefined;
  } else {
    req.csrfToken = cookies.wallCsrfToken;
  }

  // User ID: HttpOnly — only the server needs it for rate limiting
  if (!cookies.wallUserId) {
    const uid = crypto.randomUUID();
    setCookies.push(`wallUserId=${uid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${365 * 24 * 60 * 60}`);
    req.userId = undefined;
  } else {
    req.userId = cookies.wallUserId;
  }

  if (setCookies.length > 0) res.setHeader('Set-Cookie', setCookies);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Seed data ──────────────────────────────────────────────

const SEED_POOL = [
  "hello from the void",
  "does anyone actually read these?",
  "the coffee machine is broken again",
  "meeting in 5, be there or be square",
  "just testing this thing out",
  "why is the printer always out of paper",
  "good morning from somewhere cold",
  "never gonna give you up",
  "404: motivation not found",
  "anyone seen my keys",
  "reminder: water your plants",
  "this message will self-destruct",
  "hello? is this thing on?",
  "just shipped something, fingers crossed",
  "the build is broken, not my fault",
  "free donuts in the break room (gone)",
  "working from home again, the cat is judging me",
  "error: brain.exe has stopped responding",
  "monday morning, send help",
  "I fixed a bug by deleting it",
  "the documentation was wrong",
  "it works on my machine",
  "undefined is not a function",
  "shipped it. it's probably fine",
  "hot take: tabs are better than spaces",
  "hot take: spaces are better than tabs",
  "is it Friday yet",
  "just discovered a regex that summons demons",
  "the server room smells like something burning",
  "I've been staring at this bug for 3 hours",
  "turns out the bug was a missing semicolon",
  "turns out the bug was my own code from 6 months ago",
  "git blame shows it was me all along",
  "pushed to prod on a Friday. life is short",
  "the demo is tomorrow and nothing works",
  "nevermind, I fixed it",
  "the client wants it in Comic Sans",
  "dark mode should be the default",
  "I love deadlines. I love the whooshing sound they make",
  "just refactored 500 lines and nothing broke",
  "just refactored 5 lines and everything broke",
  "the tests are passing. I don't know why",
  "the tests are failing. I don't know why",
  "naming things is the hardest part",
  "this comment was written at 3am and I stand by it",
  "TODO: fix this before anyone notices",
  "FIXME: whoever wrote this owes me a coffee",
  "legacy code is just old code that works",
  "the cloud is just someone else's computer",
  "I should write tests for this",
  "I'll write tests for this later",
  "tests? where we're going we don't need tests",
  "null pointer exception in production. fun times",
  "off by one error, but which one",
  "cache invalidation is why I drink",
  "have you tried turning it off and on again",
  "ctrl+z ctrl+z ctrl+z ctrl+z ctrl+z",
  "saved a backup before the refactor. wise move",
  "forgot to save a backup. praying now",
  "the internet is back, we're saved",
  "the internet is down, we're doomed",
  "time zones are a human rights violation",
  "daylight saving time was invented by a monster",
  "I have a meeting that could have been an email",
  "I have an email that could have been nothing",
  "the code review took longer than writing the code",
  "lgtm, ship it",
  "lgtm. (did not actually look)",
  "CI is green. deploying.",
  "CI is red. investigating.",
  "CI is red. it's not a fluke.",
  "production is down. all hands.",
  "production is back up. root cause: unknown",
  "root cause found: it was DNS. it's always DNS",
  "it was not DNS. it was me.",
  "wrote a shell script to automate the boring stuff",
  "the shell script has become the boring stuff",
  "started migrating to microservices",
  "starting to migrate back from microservices",
  "just learned about a feature that was there all along",
  "just read the documentation. life changing.",
  "docs are outdated by 2 years",
  "found a bug that's been in prod for 4 years",
  "leaving this comment for future me. sorry future me.",
  "this is fine",
  "everything is fine",
  "this is not fine actually",
  "help",
  "tech debt intensifies",
  "one more coffee then I'll figure it out",
  "I figured it out. it was the config file",
  "always the config file",
  "the intern found a bug none of us noticed",
  "stack overflow had the answer, as always",
  "it's not a bug, it's a feature",
  "works in staging, broken in prod, classic",
  "rebase or merge? this is the question",
  "squash commits: controversial opinion incoming",
  "monorepo gang rise up",
  "just added another dependency. don't tell anyone",
  "we don't talk about the 2019 migration",
  "the ticket said simple change. the ticket lied.",
  "estimated 1 hour. took 3 days. normal.",
  "scrum standup in 2 minutes. panicking.",
  "velocity is a feeling",
  "sprints don't feel like sprints",
  "retrospective: could have been an email",
  "scope creep has entered the chat",
  "requirements changed again",
  "this is out of scope. unfortunately.",
  "bandwidth is low this quarter",
  "syncing async",
  "let's take this offline",
  "circling back on my earlier message",
  "per my last email...",
  "as previously stated...",
  "no news is good news (I hope)",
  "radio silence from the client. ominous.",
  "shipped at midnight. now I sleep.",
  "first commit: fix typo. second commit: rewrite everything",
  "deleted prod data. asked for forgiveness, not permission.",
  "the hotfix made it worse",
  "rollback successful. dignity: not recovered.",
  "the on-call rotation has claimed another victim",
  "3am page. fixed in 4 minutes. couldn't sleep anyway.",
  "post-mortem: we learned nothing",
  "added to the runbook. no one reads the runbook.",
  "monitoring is for people who make mistakes. (everyone)",
  "alert: something is 99th percentile",
  "the p99 is fine. the p999 is a different story.",
  "latency is just vibes",
  "distributed systems are just regular systems with extra chaos",
  "eventual consistency eventually consistent",
  "idempotency is a word I had to google",
  "the architecture diagram is already out of date",
  "drew a new architecture diagram. feels good.",
  "the whiteboard session solved nothing but was cathartic",
  "rubber duck debugging: the rubber duck was right",
  "pair programming: two keyboards, one bug",
  "mob programming: many keyboards, one bug",
  "code golf: shortest path to unmaintainability",
  "10x engineer? more like 10x technical debt",
  "move fast and break things. broke things. didn't move fast.",
  "agile manifesto open tab #47 of today",
  "the backlog is a graveyard with good intentions",
  "groomed the backlog. it'll be back.",
  "prioritized everything. nothing got done.",
  "deprioritized the important thing. oops.",
  "good enough for government work",
  "perfect is the enemy of shipped",
  "premature optimization is the root of all evil",
  "late optimization is also pretty bad",
  "the profiler said it's the database. the database disagrees.",
  "N+1 queries: the silent performance killer",
  "added an index. 10x faster. should have done this years ago.",
  "the cache is stale but so am I",
  "TTL: too long or too short, never right",
  "invalidated cache. prayed. deployed.",
  "race condition found in production by users",
  "mutex was the answer. mutex was always the answer.",
  "async/await: now with 50% more cognitive load",
  "callback hell is where I live",
  "promise rejected",
  "unhandled rejection caught... eventually",
  "try/catch/cry",
  "error swallowed silently. debugging for days.",
  "console.log driven development",
  "debugger statement left in prod. found by user.",
  "breakpoint hit in production. somehow.",
  "stack trace is just a treasure map to the real bug",
  "the real bug was the friends we made along the way",
  "fixed the symptom, not the cause",
  "root cause: human error (me)",
  "post-mortem action items: ignored",
  "wrote tests after the bug. learned nothing.",
  "TDD: test driven despair",
  "100% code coverage, 0% confidence",
  "integration tests: slow, flaky, necessary",
  "e2e tests: slower, flakier, more necessary",
  "green build, red production",
  "feature flag saved the day",
  "feature flag forgotten for 2 years",
  "A/B test showed B was worse. shipped B anyway.",
  "analytics say users do weird things",
  "the user did something we said was impossible",
  "never underestimate a user's creativity",
  "accessibility audit: we have work to do",
  "mobile responsiveness: we have work to do",
  "performance audit: we have work to do",
  "security audit: we have a LOT of work to do",
  "just dependency-updated everything. nothing broke. miracle.",
  "just dependency-updated one thing. everything broke.",
  "npm audit: 47 vulnerabilities. pick your battles.",
  "supply chain attack? in this economy?",
  "open source: free as in responsibility",
  "licensing issue discovered on Friday afternoon",
  "legal is reviewing the code. good luck everyone.",
  "GDPR compliance: ongoing",
  "data retained longer than intended. oops.",
  "right to be forgotten request received",
  "cookie banner added. users still confused.",
  "WCAG 2.1 AA. we're at level A. working on it.",
  "SEO: a dark art",
  "lighthouse score: disappointing",
  "bundle size: also disappointing",
  "Core Web Vitals: need work",
  "PageSpeed: 47. the number haunts me.",
  "rewrite in Rust? maybe.",
  "rewrite in Go? probably.",
  "rewrite from scratch? always tempting.",
  "greenfield project: beautiful disaster incoming",
  "brownfield project: beautiful disaster ongoing",
  "the legacy codebase has feelings. respect them.",
  "found comments written in a language I don't speak",
  "git log shows 8 years of history. respect.",
  "oldest commit: \"initial commit, probably fine\"",
  "newest commit: \"fix fix fix\"",
  "commit message: \"stuff\" — git blame: me, 4am, 2022",
  "squashed 40 commits into one. history cleaner, errors smoother.",
  "force pushed to main. immediately regretted.",
  "git reset --hard. a moment of silence.",
  "git stash pop. oh no.",
  "merge conflict on the line I didn't touch",
  "rebased onto wrong branch. detached HEAD.",
  "HEAD is detached. I know the feeling.",
  "cherry-picked the wrong commit",
  "the branch has 200 commits. review requested.",
  "code review: left 47 comments. tagged as nitpick.",
  "review approved with suggestion: rewrite everything",
  "LGTM from someone who wasn't involved at all",
  "opened draft PR. closed draft PR. opened PR. closed PR.",
  "finally merged. 3 weeks later than estimated.",
  "deployed to staging. staging is now prod accidentally.",
  "environment variables: the other configuration",
  "secret in git history. rotated. praying.",
  "hardcoded password found in code. it was production password.",
  "SQL injection via username field. classic.",
  "XSS via comment field. also classic.",
  "CSRF token: present but not validated. whoops.",
  "auth bypass via null byte. a Wednesday.",
  "rate limiting: added after the incident",
  "the incident could have been prevented with rate limiting",
  "added logging. now have too much logging.",
  "log level set to DEBUG in production. for 6 months.",
  "log level set to ERROR. missed the warning. oops.",
  "structured logging: JSON everywhere",
  "grep on logs is a lost art",
  "ELK stack setup. now what?",
  "DataDog bill arrived. moment of silence.",
  "Sentry caught an error I didn't know about",
  "Sentry has 10,000 unresolved issues. this is fine.",
  "alert: disk space at 99%",
  "alert: memory leak found in production",
  "alert: this is not an alert, just checking in",
  "OOM killer chose our process. rude.",
  "containerized the app. Docker image: 4GB. working on it.",
  "Kubernetes: solved the problem I created by using Kubernetes",
  "helm chart: templated YAML dreams",
  "Terraform: infrastructure as anxiety",
  "CDN cache: purged. everything is fast now.",
  "CDN cache: stale. users seeing old version for a week.",
  "serverless: now with more cold starts",
  "lambda timeout: 29 seconds wasn't enough",
  "cron job missed. nobody noticed. not sure if good or bad.",
  "webhook failed silently. data lost. discovered 3 weeks later.",
  "queue backed up. consumers overwhelmed.",
  "dead letter queue: where messages go to be forgotten",
  "idempotency key: the hero of distributed systems",
  "the state machine has entered an invalid state",
  "finite state machine: more finite than expected",
  "regex: write once, read never",
  "parse HTML with regex once. shame for life.",
  "type system saved me from myself",
  "TypeScript: the good kind of strict parent",
  "any: defeated the type system in one keystroke",
  "types: wrong at runtime despite correct at compile time",
  "null check: not null until it is",
  "optional chaining: ?.?.?.?.oops",
  "the ternary is 4 levels deep",
  "nested ternaries: a cry for help",
  "the function has 12 parameters",
  "the function has 1 parameter: a giant options object",
  "the class has 40 methods",
  "the god object sees all, knows all",
  "single responsibility principle: violated",
  "SOLID principles: bookmarked but not read",
  "design pattern: factory factory factory",
  "abstraction layer: added before the problem existed",
  "over-engineered: could have been a flat file",
  "under-engineered: was a flat file, now it's a problem",
  "technical interview question solved in production",
  "leetcode medium: I passed. the system didn't.",
  "O(n²) in production. noticed when n grew.",
  "fixed O(n²) to O(n log n). shipped. celebrated.",
  "O(1) lookup. just use a hashmap. always hashmap.",
  "hashmap collision. rare but costly.",
  "binary search: forgot it needs sorted array",
  "forgot to sort the array",
  "sorted the wrong thing",
  "off by one. always off by one.",
  "zero indexed. one indexed. chaos.",
  "UTC everywhere. always UTC.",
  "stored in local time. regret followed.",
  "epoch timestamp: reliable friend",
  "ISO 8601: the only date format",
  "date parsing: international waters",
  "timezone offset: 30 minutes. why. WHY.",
  "February 29th: the exception to every rule",
  "leap second: the exception to that",
  "2038: marked in calendar",
  "Y2K-style bug found in legacy code. the year is 2026.",
  "estimated completion: 2 weeks. actual: Q3 next year.",
  "over budget and behind schedule. in agile.",
  "the stakeholder presentation went well! (I think)",
  "requirements clarified after delivery",
  "scope creep is my constant companion",
  "definition of done: undefined",
  "done: deployed. NOT done: working.",
  "works as designed. designed wrong.",
  "ship it and forget it",
  "shipped and forgot. user reminded me.",
  "v2 coming soon (2019 promise)",
  "v1 is still in beta",
  "the beta lasted 7 years",
  "deprecated: please migrate to the new system",
  "new system deprecated. please migrate back.",
  "sunset date pushed back for the third time",
  "EOL: end of life. beginning of incident.",
  "backwards compatible: except for this one thing",
  "breaking change in patch version. oops.",
  "semantic versioning: a suggestion",
  "CHANGELOG: written retroactively",
  "release notes: see git log",
  "hotfix on hotfix on hotfix",
  "the patch was worse than the bug",
  "good enough for v1",
];

function seedMessages() {
  const now = Date.now();
  for (let i = 0; i < 2000; i++) {
    const age = Math.random() * ONE_MONTH_MS;
    messages.push({
      id: crypto.randomUUID(),
      text: SEED_POOL[i % SEED_POOL.length],
      timestamp: new Date(now - age).toISOString(),
      replies: [],
    });
  }
  messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  console.log(`Seeded ${messages.length} messages`);
}

seedMessages();

// ── Cleanup jobs ───────────────────────────────────────────

setInterval(() => {
  const cutoff = Date.now() - ONE_MONTH_MS;
  let removed = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (new Date(messages[i].timestamp).getTime() < cutoff) {
      messages.splice(i, 1);
      removed++;
    }
  }
  if (removed > 0) console.log(`Cleaned up ${removed} expired messages`);
}, ONE_HOUR_MS);

setInterval(() => {
  const cutoff = Date.now() - TEN_MIN_MS;
  for (const [key, ts] of rateLimits) {
    if (ts < cutoff) rateLimits.delete(key);
  }
}, 60 * 1000);

// ── Routes ─────────────────────────────────────────────────

app.get('/messages', (req, res) => {
  const before = req.query.before;
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || PAGE_SIZE));

  let startIdx = 0;
  if (before) {
    const idx = messages.findIndex(m => m.timestamp < before);
    startIdx = idx === -1 ? messages.length : idx;
  }

  res.json({
    messages: messages.slice(startIdx, startIdx + limit).map(m => ({
      id: m.id, text: m.text, timestamp: m.timestamp, replyCount: m.replies.length,
    })),
    hasMore: startIdx + limit < messages.length,
    total: messages.length,
  });
});

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (payload) => {
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch (_) {}
  };

  clients.add(send);
  send({ type: 'init', messages: messages.slice(0, PAGE_SIZE).map(m => ({
    id: m.id, text: m.text, timestamp: m.timestamp, replyCount: m.replies.length,
  })), total: messages.length });

  req.on('close', () => clients.delete(send));
});

app.post('/messages', (req, res) => {
  // CSRF: double-submit cookie check
  const csrfHeader = req.headers['x-csrf-token'];
  if (!req.csrfToken || req.csrfToken !== csrfHeader) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress
    || 'unknown';
  const now = Date.now();
  const ipKey = `ip:${ip}`;
  const userKey = req.userId ? `user:${req.userId}` : null;

  // Rate limit by both cookie user ID and IP — guards against cookie-clearing bypass
  const lastPost = Math.max(
    rateLimits.get(ipKey) || 0,
    userKey ? (rateLimits.get(userKey) || 0) : 0,
  );

  if (lastPost && now - lastPost < TEN_MIN_MS) {
    const retryAfter = Math.ceil((TEN_MIN_MS - (now - lastPost)) / 1000);
    return res.status(429).json({ error: 'Rate limited.', retryAfter });
  }

  const body = req.body ?? {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (!text) return res.status(400).json({ error: 'Message text is required.' });
  if (text.length > MAX_LEN) return res.status(400).json({ error: `Max ${MAX_LEN} characters.` });
  // Reject C0/C1 control characters (allow tab \x09, newline \x0a, CR \x0d)
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
    return res.status(400).json({ error: 'Invalid message content.' });
  }

  rateLimits.set(ipKey, now);
  if (userKey) rateLimits.set(userKey, now);

  const msg = {
    id: crypto.randomUUID(),
    text,
    timestamp: new Date().toISOString(),
    replies: [],
  };

  messages.unshift(msg);

  for (const send of clients) send({ type: 'message', id: msg.id, text: msg.text, timestamp: msg.timestamp, replyCount: 0 });

  res.status(201).json({ ok: true });
});

app.get('/messages/:id/replies', (req, res) => {
  const msg = messages.find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found.' });
  res.json({ replies: msg.replies });
});

app.post('/messages/:id/replies', (req, res) => {
  const csrfHeader = req.headers['x-csrf-token'];
  if (!req.csrfToken || req.csrfToken !== csrfHeader) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }

  const msg = messages.find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found.' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress
    || 'unknown';
  const now = Date.now();
  const ipKey = `ip:${ip}`;
  const userKey = req.userId ? `user:${req.userId}` : null;

  const lastPost = Math.max(
    rateLimits.get(ipKey) || 0,
    userKey ? (rateLimits.get(userKey) || 0) : 0,
  );

  if (lastPost && now - lastPost < TEN_MIN_MS) {
    const retryAfter = Math.ceil((TEN_MIN_MS - (now - lastPost)) / 1000);
    return res.status(429).json({ error: 'Rate limited.', retryAfter });
  }

  const body = req.body ?? {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (!text) return res.status(400).json({ error: 'Reply text is required.' });
  if (text.length > MAX_LEN) return res.status(400).json({ error: `Max ${MAX_LEN} characters.` });
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
    return res.status(400).json({ error: 'Invalid reply content.' });
  }

  rateLimits.set(ipKey, now);
  if (userKey) rateLimits.set(userKey, now);

  const reply = {
    id: crypto.randomUUID(),
    text,
    timestamp: new Date().toISOString(),
  };

  msg.replies.unshift(reply);

  for (const send of clients) send({ type: 'reply_count', id: msg.id, replyCount: msg.replies.length });

  res.status(201).json({ ok: true, reply });
});

app.listen(PORT, () => console.log(`Wall running at http://localhost:${PORT}`));
