import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://localhost:8000', { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/01_start.png' });

// fast-forward at max multiplier
await page.evaluate(() => { window.__sim.setSpeedMode('fixed'); window.__sim.setFixedMultiplier(1000); });

await page.waitForFunction(() => window.__sim.state.trimDeg > 3.4, null, { timeout: 120000 });
await page.screenshot({ path: 'shots/02_downbyhead.png' });

await page.waitForFunction(() => window.__sim.state.maxU > 0.75, null, { timeout: 180000 });
await page.evaluate(() => { window.__sim.setFixedMultiplier(30); });
await page.waitForFunction(() => window.__sim.state.hullBroken, null, { timeout: 180000 });
await page.waitForTimeout(900);
await page.screenshot({ path: 'shots/03_break.png' });

await page.evaluate(() => { window.__sim.setFixedMultiplier(1000); });
await page.waitForFunction(() => window.__sim.state.bowDepth > 800, null, { timeout: 120000 });
await page.evaluate(() => { window.__sim.setFixedMultiplier(60); });
await page.waitForTimeout(800);
await page.screenshot({ path: 'shots/04_descent.png' });

await page.evaluate(() => { window.__sim.setFixedMultiplier(1000); });
await page.waitForFunction(() => window.__sim.state.finished, null, { timeout: 240000 });
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/05_rest.png' });

console.log('clock at end:', await page.evaluate(() => window.__sim.clock(window.__sim.state.time)));
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
