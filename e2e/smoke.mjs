// End-to-end smoke test in Chrome for Testing: load dist/, anonymise a recital through the
// background worker and the offscreen model, restore it, and record every network request
// the extension makes (there must be none outside chrome-extension://).
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';

const chrome = process.env.CHROME_BIN;
const ext = resolve('dist');
const browser = await puppeteer.launch({
  executablePath: chrome, headless: true, pipe: true,
  enableExtensions: [ext],
  args: ['--no-first-run', '--no-default-browser-check'],
});
const external = [];
const watch = async (target) => {
  const s = await target.createCDPSession().catch(() => null);
  if (!s) return;
  await s.send('Network.enable').catch(() => {});
  s.on('Network.requestWillBeSent', (e) => { if (!e.request.url.startsWith('chrome-extension://') && !e.request.url.startsWith('data:')) external.push(e.request.url); });
};
browser.on('targetcreated', watch);
const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'));
const id = new URL(sw.url()).host;
const page = await browser.newPage();
await watch(page.target());
await page.goto(`chrome-extension://${id}/sidepanel.html`);
const text = 'THIS DEED is made on 22 January 2016 between (1) Brightstone Holdings PLC (company number 01234567) of ' +
  '9 Motcomb Street, London SW1X 8LA and (2) Priya Patel of 12 Baker Street, London, email priya.patel@example.co.uk. ' +
  'The Tenant shall comply with section 38A of the Landlord and Tenant Act 1954. Ms Patel signs as guarantor.';
const t0 = Date.now();
const r = await page.evaluate(async (text) => {
  const tab = await chrome.tabs.getCurrent();
  return chrome.runtime.sendMessage({ type: 'panel-anonymise', tabId: tab.id, text });
}, text);
const ms = Date.now() - t0;
console.log('reply:', JSON.stringify(r).slice(0,400)); console.log('reply ok:', r.ok, 'count:', r.count, `${ms} ms (incl. model load)`);
console.log('anonymised:', r.text);
console.log('items:', r.items.map((i) => `${i.placeholder}=${i.value}`).join(' | '));
const restored = r.items.reduce((acc, i) => acc.split(i.placeholder).join(i.value), r.text);
const leaked = ['Brightstone', 'Motcomb', 'SW1X', 'Priya', 'Patel', '01234567', 'example.co.uk', 'Baker'].filter((w) => r.text.includes(w));
console.log('leaked:', leaked.length ? leaked : 'none');
console.log('kept law+date:', r.text.includes('section 38A of the Landlord and Tenant Act 1954') && r.text.includes('22 January 2016'));
console.log('external requests:', external.length ? external : 'none');
await browser.close();
process.exit(r.ok && !leaked.length && !external.length ? 0 : 1);
