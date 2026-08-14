#!/usr/bin/env node
/**
 * client-response-harness.js — Cornerpost Website
 *
 * THE TEST THAT SHOULD HAVE EXISTED BEFORE A CUSTOMER SAW A PARSER ERROR.
 *
 * On 2026-08-14 a real customer submitted SR-20260814-003. It was created,
 * their confirmation email was sent, and their phone showed them:
 *
 *     Unexpected token '<', "<!DOCTYPE "... is not valid JSON
 *
 * Two separate faults, both here:
 *
 *   1. response.json() was called unconditionally, so any non-JSON body
 *      threw -- and a POST had already been sent by then, so the outcome
 *      was unknown, not failed.
 *   2. the catch rendered error.message into the page, so the customer read
 *      a JavaScript exception.
 *
 * The transient cause of that one HTML body was never reproduced and is not
 * what these tests are about. A client must survive ANY unreadable response,
 * so nothing here matches on "<!DOCTYPE" -- that would encode the symptom
 * that happened to be observed and miss the next one.
 *
 * Runs the real js/main.js in a vm with a simulated DOM, fetch and
 * sessionStorage. No browser, no framework, no dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.argv[2] || path.resolve(__dirname, '..');
const lf = t => t.replace(/\r\n/g, '\n');
const MAIN = lf(fs.readFileSync(path.join(ROOT, 'js', 'main.js'), 'utf8'));
const CONFIG = lf(fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8'));

/* Source assertions run against CODE, not comments.
 *
 * This file explains in prose what it refuses to do -- it mentions
 * "<!DOCTYPE" and "no-cors" precisely to say they are not the mechanism --
 * and a naive search finds those words and reports the opposite of the
 * truth. Strip comments first, or the test grades the documentation. */
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const MAIN_CODE = stripComments(MAIN);

let uuidSeq = 0;
function nextUuid() {
  uuidSeq += 1;
  const n = String(uuidSeq).padStart(12, '0');
  return '11111111-2222-4333-8444-' + n;
}

/* ------------------------------------------------------------------ */
/* A DOM just real enough for the submit path.                         */
/* ------------------------------------------------------------------ */
function makeElement(tag) {
  return {
    tagName: tag, dataset: {}, style: {}, attributes: {},
    className: '', textContent: '', innerHTML: '', disabled: false,
    children: [], files: [], value: '',
    classList: { add() {}, remove() {}, contains: () => false },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    focus() {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    appendChild(c) { this.children.push(c); },
    replaceChildren() { this.children = []; },
    addEventListener() {},
    reset() {}
  };
}

/**
 * Drives the REAL submit handler, end to end.
 *
 * The first version of this harness tested readSubmissionOutcome and
 * obtainSubmissionKey in isolation and never ran the handler that uses
 * them. The mutation red-check caught that immediately: restoring the
 * original `await response.json()` defect left every test green, because
 * nothing executed the code path the defect lived in. Testing the pieces a
 * bug is assembled from is not the same as testing the assembly.
 *
 * So this builds enough DOM for initServiceRequestForm to bind, captures
 * the submit listener it registers, and invokes it.
 */
function submitWorld(opts) {
  const o = opts || {};
  const w = world(o);
  const els = w.els;

  w.fn('initServiceRequestForm')();

  if (!els.form.__submit) throw new Error('submit handler was never registered');

  return Object.assign(w, {
    submit: async () => {
      await els.form.__submit({ preventDefault() {} });
      return {
        statusText: els.status.textContent + ' ' + els.status.innerHTML,
        buttonDisabled: els.submitButton.disabled,
        buttonUncertain: els.submitButton.dataset.cornerpostUncertain === 'true',
        buttonLabel: els.submitButton.textContent,
        storedKey: w.store()['cornerpost.submissionKey'],
        sentKey: (w.sentBodies()[0] || {}).submissionKey
      };
    }
  });
}

/** One submit, with fetch and sessionStorage under the test's control. */
function world(opts) {
  const o = opts || {};
  const logs = [];
  const store = Object.assign({}, o.session || {});
  const status = makeElement('div');
  const submitButton = makeElement('button');
  submitButton.textContent = 'Request Service';

  const sessionStorage = {
    getItem(k) {
      if (o.storageThrows) throw new Error('storage disabled');
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    setItem(k, v) { if (o.storageThrows) throw new Error('storage disabled'); store[k] = String(v); },
    removeItem(k) { if (o.storageThrows) throw new Error('storage disabled'); delete store[k]; }
  };

  const sentBodies = [];
  const ctx = {
    console: { error: (...a) => logs.push(a.map(String).join(' ')), warn: () => {}, log: () => {} },
    JSON, String, Number, Math, Date, Object, Array, Error, RegExp, Promise,
    Uint8Array, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    URLSearchParams, URL,
    setTimeout: (fn) => fn(),
    FormData: function () {
      this._d = {};
      this.set = (k, v) => { this._d[k] = v; };
      this.get = (k) => this._d[k];
    },
    fetch: async function (url, init) {
      sentBodies.push(init && init.body ? init.body._d : null);
      if (o.fetchRejects) throw new Error('Failed to fetch');
      return o.response;
    }
  };

  ctx.window = {
    /* EVERY world mints a DIFFERENT uuid unless the test pins one. This
     * used to return a fixed value, which made "the key was reused"
     * indistinguishable from "an identical key was generated again" -- so the
     * reload tests passed even with persistence removed. The red-check caught
     * it. A distinct value per page load is what makes reuse provable. */
    crypto: { randomUUID: () => (o.uuid || nextUuid()) },
    sessionStorage: sessionStorage,
    location: { pathname: '/contact.html', search: '', href: 'https://cornerpostplumbing.com/contact.html' },
    addEventListener() {}
  };
  /* Enough real DOM for initServiceRequestForm to bind to. */
  const form = makeElement('form');
  form.addEventListener = function (type, fn) { if (type === 'submit') form.__submit = fn; };
  const fileInput = makeElement('input'); fileInput.files = [];
  const els = {
    form,
    status: status,
    submitButton: submitButton,
    fileInput,
    fileList: makeElement('div'),
    phoneInput: makeElement('input'),
    billingSameInput: makeElement('input'),
    billingFields: makeElement('div')
  };
  form.querySelector = function (sel) {
    if (sel.indexOf("type='submit'") !== -1) return els.submitButton;
    if (sel.indexOf("name='phone'") !== -1) return els.phoneInput;
    if (sel.indexOf("name='photoFiles'") !== -1) return els.fileInput;
    if (sel.indexOf('billingSameAsService') !== -1) return els.billingSameInput;
    if (sel.indexOf('data-billing-address') !== -1) return els.billingFields;
    return makeElement('div');
  };
  form.querySelectorAll = () => [];
  ctx.__els = els;

  ctx.document = {
    readyState: 'complete',
    addEventListener() {},
    getElementById: (id) => {
      if (id === 'request-service-form') return els.form;
      if (id === 'form-status') return els.status;
      if (id === 'file-list') return els.fileList;
      return null;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: makeElement,
    body: makeElement('body'),
    documentElement: makeElement('html')
  };
  ctx.globalThis = ctx;
  ctx.navigator = { userAgent: 'test' };

  vm.createContext(ctx);
  vm.runInContext(CONFIG, ctx, { filename: 'config.js' });
  vm.runInContext(MAIN, ctx, { filename: 'main.js' });

  return {
    fn: n => vm.runInContext(n, ctx),
    ctx, logs: () => logs, store: () => store, els,
    status, submitButton, sentBodies: () => sentBodies
  };
}

const jsonResponse = (obj, status) => ({
  ok: status === undefined ? true : status < 400,
  status: status === undefined ? 200 : status,
  headers: { get: () => 'application/json; charset=utf-8' },
  text: async () => JSON.stringify(obj)
});
const htmlResponse = (status) => ({
  ok: status === undefined ? true : status < 400,
  status: status === undefined ? 200 : status,
  headers: { get: () => 'text/html; charset=utf-8' },
  text: async () => '<!DOCTYPE html><html><head><title>Error</title></head><body>nope</body></html>'
});
const brokenResponse = () => ({
  ok: true, status: 200,
  headers: { get: () => 'application/json' },
  text: async () => '{"success": tru'
});
const unreadableResponse = () => ({
  ok: true, status: 200,
  headers: { get: () => 'application/json' },
  text: async () => { throw new Error('network error reading body'); }
});

console.log('\n' + '='.repeat(68));
console.log('  Cornerpost — website client response contract');
console.log('  success / rejection / UNKNOWN, and the key that survives a reload');
console.log('='.repeat(68) + '\n');

let passed = 0;
const failures = [];
function check(name, thunk) {
  let ok = false, detail = '';
  try { ok = thunk() === true; } catch (e) { detail = ' [' + e.message + ']'; }
  if (ok) { passed += 1; console.log('    ok    ' + name); }
  else { failures.push(name + detail); console.log('    FAIL  ' + name + detail); }
}
function section(t) { console.log('\n  ' + t); }

/* readSubmissionOutcome is the contract; test it directly and exactly. */
async function outcome(w, response) {
  return await w.fn('readSubmissionOutcome')(response);
}

(async function () {

section('The response contract');

const w = world({});

const r1 = await outcome(w, jsonResponse({ success: true, requestNumber: 'SR-1' }));
check('1  valid JSON success -> success', () => r1.state === 'success' && r1.body.requestNumber === 'SR-1');

const r2 = await outcome(w, jsonResponse({ success: false, error: 'Phone is required.' }));
check('2  structured server rejection -> rejected', () => r2.state === 'rejected' && r2.body.error === 'Phone is required.');

const r3 = await outcome(w, jsonResponse({ success: false, error: 'Nope' }, 400));
check('3  HTTP error carrying JSON is still an ANSWER, not unknown',
  () => r3.state === 'rejected' && r3.body.error === 'Nope');

const r4 = await outcome(w, htmlResponse(500));
check('4  HTTP error with HTML -> unknown', () => r4.state === 'unknown');

const r5 = await outcome(w, htmlResponse(200));
check('5  HTTP 200 with HTML -> unknown  (the real incident)', () => r5.state === 'unknown');

const r6 = await outcome(w, brokenResponse());
check('6  malformed JSON -> unknown', () => r6.state === 'unknown');

const r7 = await outcome(w, unreadableResponse());
check('7  body that cannot be read -> unknown', () => r7.state === 'unknown');

const r8 = await outcome(w, jsonResponse({ ok: 'yes' }));
check('8  JSON that does not match the contract -> unknown', () => r8.state === 'unknown');

check('9  the contract does NOT special-case "<!DOCTYPE"',
  () => MAIN_CODE.indexOf('DOCTYPE') === -1);

section('Nothing technical reaches the customer');

check('10 raw error.message is never rendered into status',
  () => !/setStatus\(\s*status,\s*error\.message/.test(MAIN));
check('11 uncertain wording comes from configuration, not hard-coded strings',
  () => /forms\.uncertainMessage/.test(MAIN) && /uncertainMessage:/.test(CONFIG));
check('12 the uncertain message never claims the request failed',
  () => {
    const m = (CONFIG.match(/uncertainMessage:\s*"([^"]+)"/) || [])[1] || '';
    return m.length > 0 && !/fail|error|wrong|unable/i.test(m);
  });
check('13 the uncertain message tells the customer NOT to resend',
  () => /do not submit it again/i.test(CONFIG));
check('14 the uncertain state offers a phone path',
  /* The approved copy carries the number inside the sentence itself, so the
     assertion follows the copy rather than the earlier composed version. */
  () => /308-225-3392/.test(CONFIG) && /uncertainMessage/.test(MAIN_CODE));
check('14b the approved wording is rendered verbatim, not paraphrased', () => {
  const approved = "Your request may have been received, so please do not submit it again. If you receive a confirmation email, your request was received successfully. If you need immediate confirmation, please call us at 308-225-3392.";
  return CONFIG.indexOf(approved) !== -1;
});

section('The submit button after an uncertain outcome');

check('15 uncertain marks the button and disables it', () => {
  const x = world({});
  x.fn('markSubmissionUncertain')(x.submitButton, x.fn('getConfig')());
  return x.submitButton.disabled === true &&
    x.submitButton.dataset.cornerpostUncertain === 'true' &&
    x.submitButton.getAttribute('aria-disabled') === 'true';
});
check('16 the finally block refuses to re-arm an uncertain button',
  () => /cornerpostUncertain !== "true"/.test(MAIN_CODE));
check('17 ...and still re-enables it for ordinary known outcomes',
  () => /submitButton\.disabled = false/.test(MAIN));

section('Submission key lifecycle');

check('18 a key is created and PERSISTED before the POST', () => {
  const x = world({});
  const k = x.fn('obtainSubmissionKey')();
  return /^WSR-/.test(k) && x.store()['cornerpost.submissionKey'] === k;
});
check('19 a reload in the same session reuses the SAME key', () => {
  const first = world({});
  const k = first.fn('obtainSubmissionKey')();
  const afterReload = world({ session: first.store() });   // new page, same session
  return afterReload.fn('obtainSubmissionKey')() === k;
});
check('20 a fresh browser session gets a NEW key', () => {
  const a = world({}); const ka = a.fn('obtainSubmissionKey')();
  const b = world({ uuid: '99999999-8888-4777-8666-555555555555' });
  return b.fn('obtainSubmissionKey')() !== ka;
});
check('21 confirmed success clears the persisted key', () => {
  const x = world({});
  x.fn('obtainSubmissionKey')();
  x.fn('clearStoredSubmissionKey')();
  return x.store()['cornerpost.submissionKey'] === undefined;
});
check('22 an uncertain outcome does NOT clear the key', () => {
  /* The submit handler clears on confirmed success and nowhere else.
     Two occurrences in code: the declaration, and exactly one call. */
  const clears = (MAIN_CODE.match(/clearStoredSubmissionKey\(\)/g) || []).length;
  const successBlock = /clearStoredSubmissionKey\(\);\s*\n\s*showSuccess/.test(MAIN_CODE);
  return clears === 2 && successBlock;
});
check('23 storage being unavailable never throws into the submit path', () => {
  const x = world({ storageThrows: true });
  const k = x.fn('obtainSubmissionKey')();
  return /^WSR-/.test(k);
});
check('24 the key format still satisfies the Service System contract', () => {
  const x = world({});
  return /^WSR-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
    .test(x.fn('obtainSubmissionKey')());
});

section('END TO END — the real submit handler');

/* These drive form.submit() for real. Everything above tests the parts;
   these test the assembly, which is where the original defect lived. */

const e1 = await submitWorld({ response: jsonResponse({ success: true, requestNumber: 'SR-20260814-999' }) }).submit();
check('E1 confirmed success shows the RequestNumber and clears the stored key',
  () => /SR-20260814-999/.test(e1.statusText) && e1.storedKey === undefined && e1.buttonUncertain === false);

const e2 = await submitWorld({ response: jsonResponse({ success: false, error: 'Phone is required.' }) }).submit();
check('E2 definitive rejection shows the server message and keeps the key',
  () => /Phone is required\./.test(e2.statusText) && /^WSR-/.test(e2.storedKey || ''));

const e3 = await submitWorld({ response: htmlResponse(200) }).submit();
check('E3 HTML body -> uncertain, never "failed"', () => {
  return /may have been received/i.test(e3.statusText) &&
    !/Unexpected token|SyntaxError|DOCTYPE|failed/i.test(e3.statusText);
});
check('E4 ...the key is KEPT so a retry is the same request',
  () => /^WSR-/.test(e3.storedKey || ''));
check('E5 ...and the button is locked, not re-armed',
  () => e3.buttonDisabled === true && e3.buttonUncertain === true);
check('E5b ...and does not sit there claiming it is still "Sending..."',
  /* Browser testing caught this: the label survived from submit and the
     finally block deliberately will not touch an uncertain button. */
  () => e3.buttonLabel === 'Request Service');

const e6 = await submitWorld({ fetchRejects: true }).submit();
check('E6 a network failure is uncertain too, with no raw exception shown',
  () => /may have been received/i.test(e6.statusText) &&
    !/Failed to fetch|TypeError/i.test(e6.statusText) && e6.buttonDisabled === true);

const e7 = await submitWorld({ response: brokenResponse() }).submit();
check('E7 malformed JSON -> uncertain, key kept, button locked',
  () => /may have been received/i.test(e7.statusText) &&
    /^WSR-/.test(e7.storedKey || '') && e7.buttonUncertain === true);

const e8 = await submitWorld({ response: jsonResponse({ success: true, requestNumber: 'SR-1' }) }).submit();
check('E8 the key is sent to the server with the POST',
  () => /^WSR-/.test(e8.sentKey || ''));

const first = submitWorld({ response: htmlResponse(200) });
const r9 = await first.submit();
const second = submitWorld({ session: first.store(), response: jsonResponse({ success: true, requestNumber: 'SR-2' }) });
const r9b = await second.submit();
check('E9 a reload after an uncertain result REUSES the same key end to end',
  () => r9.storedKey && r9b.sentKey === r9.storedKey);

section('What did not change');

check('25 no mode:"no-cors" on the submit fetch',
  () => !/no-cors/.test(MAIN_CODE));
check('26 the POST is still a simple request (FormData, no custom headers)',
  () => /body: formData/.test(MAIN) && !/headers:\s*\{/.test(MAIN.slice(MAIN.indexOf('await fetch(scriptURL'), MAIN.indexOf('await fetch(scriptURL') + 220)));
check('27 confirmed success still shows the RequestNumber',
  () => /showSuccess\(status, result\.requestNumber\)/.test(MAIN));
check('28 a definitive rejection still shows the server message',
  () => /result\?\.error \|\| buildErrorWithPhone/.test(MAIN));
check('29 client-side validation is untouched',
  () => /function validate|required/i.test(MAIN));
check('30 the endpoint is still read from configuration',
  () => /scriptURL/.test(CONFIG) && /forms\?\.scriptURL|forms\.scriptURL/.test(MAIN));

console.log('\n' + '-'.repeat(68));
console.log('  ' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) { console.log('\n  failures:'); failures.forEach(f => console.log('    - ' + f)); }
console.log('-'.repeat(68) + '\n');
process.exit(failures.length ? 1 : 0);

})();
