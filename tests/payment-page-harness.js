#!/usr/bin/env node
/**
 * payment-page-harness.js — Cornerpost invoice payment page
 *
 * Runs the real pay/payment.js under `vm` against a simulated browser: a
 * small DOM, a fake PayPal SDK whose eligibility answers are the variable
 * under test, a fake Google Pay client, and a fake fetch that records
 * every request the page makes. No build step, no framework, no
 * dependencies -- the same conventions as the other harnesses here.
 *
 *   node tests/payment-page-harness.js
 *
 * Exits non-zero on failure and prints `N passed, M failed`.
 *
 * WHAT IS SIMULATED AND WHAT IS NOT. Nothing this page owns is mocked:
 * the rendering, the eligibility gating, the busy guard, the request
 * shapes and the settlement handling are the real ones, read from the
 * real file. The simulated boundary is everything outside the page --
 * the network, the PayPal SDK and Google Pay.
 *
 * WHAT IT IS DEFENDING. The page has no authority and must never gain
 * any: it cannot name an amount, cannot name an invoice, cannot decide a
 * payment happened, and cannot offer a method the SDK says is unusable.
 *
 * Red-check every new assertion: break the thing it protects, watch it
 * fail, put it back. An assertion that has never failed is a comment.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const PAGE_JS = fs.readFileSync(path.join(ROOT, 'pay', 'payment.js'), 'utf8');
const PAGE_HTML = fs.readFileSync(path.join(ROOT, 'pay', 'index.html'), 'utf8');

const TOKEN = 'a1b2c3d4'.repeat(8);

console.log('');
console.log('  Cornerpost — invoice payment page');
console.log('  the page offers ways to pay, and decides nothing');
console.log('');

let pass = 0;
const failures = [];
const async_ = [];

function check(label, thunk) {
  let ok = false, detail = '';
  try { ok = thunk() === true; }
  catch (e) { detail = ' [' + String(e && e.message).slice(0, 120) + ']'; }
  if (ok) { pass += 1; console.log('    ok    ' + label); }
  else { failures.push(label + detail); console.log('    FAIL  ' + label + detail); }
}

function checkAsync(label, thunk) { async_.push({ label: label, thunk: thunk }); }
function section(t) { console.log('\n  ' + t); }

/* ── The simulated browser ───────────────────────────────────────────── */

function element(tag) {
  return {
    tagName: tag, children: [], className: '', textContent: '', href: '',
    src: '', async: false, hidden: false, disabled: false, dataset: {},
    attributes: {}, listeners: {},
    addEventListener(name, fn) { this.listeners[name] = fn; },
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(child) { this.children.push(child); }
  };
}

/**
 * @param {Object} o
 *   eligible          which methods the PayPal SDK reports
 *   deviceCanPay      what Google's isReadyToPay answers
 *   noGoogleLibrary   Google's script does not load
 *   context           the context result the server returns
 *   checkout          the checkout config the server returns
 *   createOrder       the createOrder result
 *   settle            the settle result
 *   contextTransport  override the transport envelope on context
 *   search            the query string
 */
function page(o) {
  const opts = o || {};
  const eligible = Object.assign(
    { paypal: true, venmo: true, googlepay: true }, opts.eligible || {});

  const requests = [];
  const sessions = [];
  const scripts = [];
  const world = { requests, sessions, scripts, logs: [] };

  const buttons = {};
  ['venmo', 'paypal', 'google-pay', 'apple-pay'].forEach(function (m) {
    const b = element('button');
    b.dataset.paymentMethod = m;
    b.hidden = (m === 'apple-pay');
    buttons[m] = b;
  });

  const nodes = {
    'payment-status': element('div'),
    'payment-content': element('div'),
    'invoice-title-number': element('span'),
    'invoice-number': element('dd'),
    'invoice-date': element('dd'),
    'balance-due': element('strong'),
    'business-name': element('span'),
    'business-phone': element('a'),
    'business-email': element('a')
  };
  nodes['payment-content'].hidden = true;
  const options = element('section');

  const head = element('head');
  const doc = {
    head: head,
    getElementById(id) { return nodes[id] || null; },
    querySelector(sel) {
      if (sel === '.payment-options') return options;
      const m = /\[data-payment-method="([^"]+)"\]/.exec(sel);
      if (m) return buttons[m[1]] || null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '.payment-button') {
        return Object.keys(buttons).map(function (k) { return buttons[k]; });
      }
      return [];
    },
    createElement(tag) {
      const el = element(tag);
      if (tag === 'script') {
        /* Loading a script is what makes the SDKs appear, exactly as it
           does in a browser. */
        Object.defineProperty(el, 'src', {
          set(value) {
            scripts.push(value);
            setTimeout(function () {
              if (value.indexOf('pay.google.com') !== -1) {
                if (!opts.noGoogleLibrary) ctx.window.google = googleLibrary();
                el.onload ? el.onload() : null;
                return;
              }
              ctx.window.paypal = paypalSdk();
              el.onload ? el.onload() : null;
            }, 0);
          },
          get() { return ''; }
        });
      }
      return el;
    }
  };

  function session(kind) {
    const s = {
      kind: kind, started: 0, confirmed: 0, options: null, presentation: null,
      start(presentation, orderPromise) {
        s.started += 1;
        s.presentation = presentation;
        return Promise.resolve(orderPromise).then(function (order) {
          s.orderId = order && order.orderId;
          /* A real checkout does not approve itself the instant it opens.
             Tests about what happens BEFORE approval -- cancelling, mainly
             -- need that gap to exist. */
          if (opts.autoApprove === false) return undefined;
          return s.options.onApprove({ orderId: s.orderId });
        });
      },
      confirmOrder(payload) { s.confirmed += 1; s.confirmedWith = payload; return Promise.resolve(); },
      getGooglePayConfig() {
        return Promise.resolve({
          apiVersion: 2, apiVersionMinor: 0, countryCode: 'US',
          allowedPaymentMethods: [{ type: 'CARD' }],
          merchantInfo: { merchantId: 'fake' }
        });
      },
      hasReturned() { return false; },
      resume() {}
    };
    sessions.push(s);
    return s;
  }

  function paypalSdk() {
    return {
      createInstance(config) {
        world.instanceConfig = config;
        return Promise.resolve({
          findEligibleMethods(query) {
            world.eligibilityQuery = query;
            return Promise.resolve({
              isEligible(key) { return !!eligible[key]; }
            });
          },
          createPayPalOneTimePaymentSession(o2) {
            const s = session('paypal'); s.options = o2; return s;
          },
          createVenmoOneTimePaymentSession(o2) {
            const s = session('venmo'); s.options = o2; return s;
          },
          createGooglePayOneTimePaymentSession(o2) {
            const s = session('googlepay'); s.options = o2; return s;
          }
        });
      }
    };
  }

  function googleLibrary() {
    return {
      payments: {
        api: {
          PaymentsClient: function (config) {
            world.googlePayConfig = config;
            this.isReadyToPay = function (request) {
              world.isReadyToPayRequest = request;
              return Promise.resolve({
                result: opts.deviceCanPay === undefined ? true : opts.deviceCanPay
              });
            };
            this.loadPaymentData = function (request) {
              world.paymentDataRequest = request;
              return Promise.resolve(config.paymentDataCallbacks
                .onPaymentAuthorized({ paymentMethodData: { type: 'CARD' } }))
                .then(function (answer) { world.googlePayResult = answer; return answer; });
            };
          }
        }
      }
    };
  }

  const CONTEXT = Object.assign({
    found: true, state: 'payable', invoiceNumber: '1035',
    invoiceDate: 'August 29, 2026', billedTo: '', balanceDue: '$174.00',
    paidOn: '',
    business: { name: 'Cornerpost Plumbing', phone: '308-225-3392',
      email: 'service@cornerpostplumbing.com', website: 'cornerpostplumbing.com' },
    logoDataUri: 'data:image/png;base64,AAAA'
  }, opts.context || {});

  const CHECKOUT = opts.checkout === undefined ? {
    enabled: true, clientId: 'sandbox-client-id',
    sdkOrigin: 'https://www.sandbox.paypal.com', googlePayEnvironment: 'TEST'
  } : opts.checkout;

  function answerFor(body) {
    if (body.action === 'context') {
      if (opts.contextTransport) return opts.contextTransport;
      return { transport: 'ok', action: 'context',
        result: world.contextOverride || CONTEXT, checkout: CHECKOUT };
    }
    if (body.action === 'createOrder') {
      return { transport: 'ok', action: 'createOrder',
        result: opts.createOrder || { ok: true, orderId: 'ORD-1', displayTotal: '174.00' } };
    }
    return { transport: 'ok', action: 'settle',
      result: opts.settle || { recorded: true, settled: true } };
  }

  const ctx = {
    console: {
      log(m) { world.logs.push(String(m)); },
      warn(m) { world.logs.push(String(m)); },
      error(m) { world.logs.push(String(m)); }
    },
    String, Number, Object, Array, Boolean, JSON, Math, Date, Error, RegExp,
    Promise, setTimeout, URLSearchParams,
    document: doc,
    window: {
      location: { search: opts.search === undefined ? '?t=' + TOKEN : opts.search }
    },
    fetch(url, init) {
      const body = JSON.parse(init.body);
      requests.push({ url: url, init: init, body: body });
      if (opts.networkFails) return Promise.reject(new Error('offline'));
      const answer = answerFor(body);
      return Promise.resolve({
        ok: opts.httpFails ? false : true,
        json() { return Promise.resolve(answer); }
      });
    }
  };
  ctx.window.document = doc;
  ctx.URLSearchParams = URLSearchParams;
  vm.createContext(ctx);
  vm.runInContext(PAGE_JS, ctx, { filename: 'pay/payment.js' });

  world.ctx = ctx;
  world.nodes = nodes;
  world.buttons = buttons;
  world.options = options;
  world.status = function () { return nodes['payment-status']; };
  world.visibleMethods = function () {
    return Object.keys(buttons)
      .filter(function (k) { return !buttons[k].hidden; }).sort();
  };
  world.press = function (method) {
    const b = buttons[method];
    if (!b || !b.listeners.click) throw new Error('no handler on ' + method);
    return b.listeners.click();
  };
  world.bodies = function (action) {
    return requests.map(function (r) { return r.body; })
      .filter(function (b) { return !action || b.action === action; });
  };
  return world;
}

function settle() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

/* ── The page does not carry the old hard-coded invoice ──────────────── */
section('A  Nothing invoice-specific is baked into the page');

check('A1  index.html carries no invoice number, date or amount', () => {
  return PAGE_HTML.indexOf('1035') === -1 &&
    PAGE_HTML.indexOf('August 29') === -1 &&
    PAGE_HTML.indexOf('174.00') === -1 &&
    PAGE_HTML.indexOf('$1') === -1;
});

check('A2  payment.js carries none either', () => {
  return PAGE_JS.indexOf('1035') === -1 &&
    PAGE_JS.indexOf('August 29') === -1 &&
    PAGE_JS.indexOf('174.00') === -1;
});

check('A3  NO SECRET AND NO CLIENT ID IS IN THE REPOSITORY. The client id ' +
      'is public browser configuration, but it still comes from the ' +
      'server so Sandbox and Live stay one fact in one place', () => {
  return !/CLIENT_SECRET|clientSecret/.test(PAGE_JS) &&
    !/AZ[A-Za-z0-9_-]{40,}/.test(PAGE_JS) &&
    /checkout\.clientId/.test(PAGE_JS);
});

check('A4  the SDK origin comes from the server too, never a literal', () => {
  return /checkout\.sdkOrigin \+ "\/web-sdk\/v6\/core"/.test(PAGE_JS) &&
    PAGE_JS.indexOf('https://www.sandbox.paypal.com') === -1 &&
    PAGE_JS.indexOf('https://www.paypal.com') === -1;
});

/* ── Context ─────────────────────────────────────────────────────────── */
section('B  Loading the invoice');

checkAsync('B1  a payable invoice renders the authoritative values, as given',
  async () => {
    const p = page({});
    await settle(); await settle(); await settle();
    return p.nodes['invoice-number'].textContent === '1035' &&
      p.nodes['invoice-date'].textContent === 'August 29, 2026' &&
      p.nodes['balance-due'].textContent === '$174.00' &&
      p.nodes['payment-content'].hidden === false;
  });

checkAsync('B2  ...and the footer contact comes from the server', async () => {
  const p = page({});
  await settle(); await settle();
  return p.nodes['business-phone'].textContent === '308-225-3392' &&
    p.nodes['business-email'].href === 'mailto:service@cornerpostplumbing.com';
});

checkAsync('B3  THE TOKEN IS THE ONLY ACCESS CAPABILITY -- no token, no ' +
  'request is even made', async () => {
  const p = page({ search: '' });
  await settle();
  return p.requests.length === 0 &&
    /payment link is incomplete/.test(p.status().textContent);
});

checkAsync('B4  a malformed token is refused before any request', async () => {
  const p = page({ search: '?t=nothex' });
  await settle();
  return p.requests.length === 0;
});

checkAsync('B5  AN ALREADY-PAID INVOICE OFFERS NO CHECKOUT', async () => {
  const p = page({ context: { state: 'settled', balanceDue: '$0.00',
    paidOn: 'September 9, 2026' } });
  await settle(); await settle();
  return p.options.hidden === true &&
    /already been paid|was paid on/.test(p.status().textContent) &&
    p.bodies('createOrder').length === 0;
});

checkAsync('B6  AN UNAVAILABLE INVOICE OFFERS NO CHECKOUT and says why ' +
  'nothing', async () => {
  const p = page({ context: { state: 'unavailable' } });
  await settle(); await settle();
  return p.nodes['payment-content'].hidden === true &&
    /not currently available/.test(p.status().textContent) &&
    p.bodies('createOrder').length === 0;
});

checkAsync('B7  CHECKOUT CONFIG WITHHELD MEANS NO ACTIVE CONTROLS', async () => {
  const p = page({ checkout: { enabled: false } });
  await settle(); await settle();
  return p.options.hidden === true && p.scripts.length === 0 &&
    p.visibleMethods().length === 0;
});

checkAsync('B8  a backend failure says something calm and nothing internal',
  async () => {
    const p = page({ networkFails: true });
    await settle(); await settle();
    const said = p.status().textContent;
    return /unable to load this invoice/.test(said) &&
      said.indexOf(TOKEN) === -1 && said.indexOf('offline') === -1;
  });

/* ── Eligibility ─────────────────────────────────────────────────────── */
section('C  Only what this buyer can actually use');

checkAsync('C1  all three eligible -> all three offered, Apple Pay still ' +
  'hidden', async () => {
  const p = page({});
  await settle(); await settle(); await settle();
  return p.visibleMethods().join(',') === 'google-pay,paypal,venmo';
});

checkAsync('C2  the SDK is asked for all three components, in USD', async () => {
  const p = page({});
  await settle(); await settle(); await settle();
  return (p.instanceConfig.components || []).slice().sort().join(',') ===
    'googlepay-payments,paypal-payments,venmo-payments' &&
    p.eligibilityQuery.currencyCode === 'USD' &&
    p.instanceConfig.pageType === 'checkout';
});

checkAsync('C3  VENMO INELIGIBLE -> hidden, not a disabled button', async () => {
  const p = page({ eligible: { venmo: false } });
  await settle(); await settle(); await settle();
  return p.buttons.venmo.hidden === true &&
    p.visibleMethods().indexOf('venmo') === -1;
});

checkAsync('C4  GOOGLE PAY INELIGIBLE AT PAYPAL -> hidden, and Google is ' +
  'never asked', async () => {
  const p = page({ eligible: { googlepay: false } });
  await settle(); await settle(); await settle();
  return p.buttons['google-pay'].hidden === true &&
    p.googlePayConfig === undefined;
});

checkAsync('C5  GOOGLE PAY ELIGIBLE BUT THE DEVICE CANNOT PAY -> still ' +
  'hidden. Both must agree.', async () => {
  const p = page({ deviceCanPay: false });
  await settle(); await settle(); await settle();
  return p.buttons['google-pay'].hidden === true &&
    p.isReadyToPayRequest !== undefined;
});

checkAsync("C6  Google's library missing -> no Google Pay, others unaffected",
  async () => {
    const p = page({ noGoogleLibrary: true });
    await settle(); await settle(); await settle();
    return p.buttons['google-pay'].hidden === true &&
      p.visibleMethods().join(',') === 'paypal,venmo';
  });

checkAsync('C7  nothing eligible -> the page says so once and offers ' +
  'nothing', async () => {
  const p = page({ eligible: { paypal: false, venmo: false, googlepay: false } });
  await settle(); await settle(); await settle();
  return p.visibleMethods().length === 0 && p.options.hidden === true &&
    /pay by mail/i.test(p.status().textContent);
});

/* ── The requests the page makes ─────────────────────────────────────── */
section('D  What the browser is allowed to say');

checkAsync('D1  EVERY REQUEST IS A CORS SIMPLE REQUEST -- text/plain, no ' +
  'custom headers, credentials omitted', async () => {
  const p = page({});
  await settle(); await settle(); await settle();
  await p.press('venmo');
  await settle();
  return p.requests.length > 1 && p.requests.every(function (r) {
    const h = r.init.headers || {};
    return r.init.method === 'POST' &&
      h['Content-Type'] === 'text/plain;charset=utf-8' &&
      Object.keys(h).length === 1 &&
      r.init.credentials === 'omit';
  });
});

checkAsync('D2  CREATE-ORDER SENDS NO AMOUNT AND NO INVOICE -- only the ' +
  'action and the token', async () => {
  const p = page({});
  await settle(); await settle(); await settle();
  await p.press('paypal');
  await settle();
  const body = p.bodies('createOrder')[0];
  return !!body && Object.keys(body).sort().join(',') === 'action,token';
});

checkAsync('D3  SETTLE SENDS ONLY action, token AND orderId', async () => {
  const p = page({});
  await settle(); await settle(); await settle();
  await p.press('paypal');
  await settle();
  const body = p.bodies('settle')[0];
  return !!body && Object.keys(body).sort().join(',') === 'action,orderId,token';
});

checkAsync('D4  no request ever carries an amount, a balance or an invoice ' +
  'id under any name', async () => {
  const p = page({});
  await settle(); await settle(); await settle();
  await p.press('venmo');
  await settle();
  return p.bodies().every(function (b) {
    return Object.keys(b).every(function (k) {
      return !/amount|total|price|balance|invoice|customer/i.test(k);
    });
  });
});

/* ── Guards and cancellation ─────────────────────────────────────────── */
section('E  Repeated taps, cancellation, and staying usable');

checkAsync('E1  A DOUBLE TAP OPENS ONE CHECKOUT, not two', async () => {
  const p = page({});
  await settle(); await settle(); await settle();
  p.press('venmo');
  p.press('venmo');
  await settle(); await settle();
  return p.bodies('createOrder').length === 1;
});

checkAsync('E2  ...and every other method is locked while one is in flight',
  async () => {
    const p = page({});
    await settle(); await settle(); await settle();
    p.press('venmo');
    const lockedDuring = p.buttons.paypal.disabled === true;
    await settle(); await settle();
    return lockedDuring;
  });

checkAsync('E3  CANCELLATION RESTORES A USABLE PAGE and is not an error ' +
  'needing office intervention', async () => {
    const p = page({ autoApprove: false });
    await settle(); await settle(); await settle();
    p.press('venmo');
    await settle(); await settle();
    const venmo = p.sessions.filter(function (s) { return s.kind === 'venmo'; })[0];
    venmo.options.onCancel();
    const said = p.status().textContent;
    return /nothing has been charged/i.test(said) &&
      p.status().dataset.kind !== 'error' &&
      /* usable again: the controls are back, and nothing was recorded */
      p.buttons.venmo.disabled === false &&
      p.buttons.paypal.disabled === false &&
      p.options.hidden === false &&
      p.bodies('settle').length === 0;
  });

checkAsync('E4  a server refusal to open a checkout is reported without ' +
  'internals, and the buttons stay usable', async () => {
  const p = page({ createOrder: { ok: false, reason: 'amountchanged',
    diagnostic: 'PAYPAL_ORDER_422' } });
  await settle(); await settle(); await settle();
  await p.press('paypal');
  await settle();
  const said = p.status().textContent;
  return /balance on this invoice changed/i.test(said) &&
    said.indexOf('PAYPAL_ORDER_422') === -1 &&
    p.options.hidden === false;
});

/* ── Settlement ──────────────────────────────────────────────────────── */
section('F  Only the server decides a payment happened');

checkAsync('F1  APPROVAL ALONE RECORDS NOTHING -- settle is always asked',
  async () => {
    const p = page({});
    await settle(); await settle(); await settle();
    await p.press('paypal');
    await settle();
    return p.bodies('settle').length === 1;
  });

checkAsync('F2  A RECORDED PAYMENT TRIGGERS A FRESH AUTHORITATIVE CONTEXT ' +
  'READ rather than trusting the picture it was handed', async () => {
  const p = page({});
  await settle(); await settle(); await settle();
  const before = p.bodies('context').length;
  await p.press('paypal');
  await settle(); await settle();
  return p.bodies('context').length === before + 1 &&
    /payment has been received/i.test(p.status().textContent) &&
    p.options.hidden === true;
});

checkAsync('F3  A DURABLE PAYMENT WHOSE PAGE READ FAILED IS STILL A ' +
  'SUCCESS, never a failure that invites paying again', async () => {
  const p = page({ settle: { recorded: true, readModelUnavailable: true,
    invoiceNumber: '1035' } });
  await settle(); await settle(); await settle();
  await p.press('paypal');
  await settle(); await settle();
  const said = p.status().textContent;
  return /received/i.test(said) && p.status().dataset.kind === 'success' &&
    !/failed|try again/i.test(said);
});

checkAsync('F4  AN UNCERTAIN SETTLEMENT TELLS THE CUSTOMER NOT TO PAY ' +
  'AGAIN', async () => {
  const p = page({ settle: { recorded: false, reason: 'uncertain' } });
  await settle(); await settle(); await settle();
  await p.press('paypal');
  await settle();
  const said = p.status().textContent;
  return /do not[\s\S]{0,40}submit another payment/i.test(said) &&
    !/try again/i.test(said);
});

checkAsync('F5  A SETTLEMENT THE SERVER HAD ALREADY RECORDED IS TREATED AS ' +
  'THE SUCCESS IT IS -- exactly-once lives on the server, and the page ' +
  'does not start a second payment over it', async () => {
  const p = page({ settle: { recorded: true, settled: true } });
  await settle(); await settle(); await settle();
  await p.press('paypal');
  await settle(); await settle();
  return /received/i.test(p.status().textContent) &&
    p.bodies('createOrder').length === 1;
});

checkAsync('F6  no capture id, order id or token is ever shown to the ' +
  'customer', async () => {
  const p = page({});
  await settle(); await settle(); await settle();
  await p.press('paypal');
  await settle(); await settle();
  const said = p.status().textContent;
  return said.indexOf('ORD-1') === -1 && said.indexOf(TOKEN) === -1 &&
    said.indexOf('CAP-') === -1;
});

/* ── Google Pay ──────────────────────────────────────────────────────── */
section('G  Google Pay, which is shaped differently');

checkAsync('G1  the sheet shows the SERVER figure for the order it just ' +
  'created, never one the page composed', async () => {
  const p = page({});
  await settle(); await settle(); await settle();
  await p.press('google-pay');
  await settle();
  const info = p.paymentDataRequest.transactionInfo;
  return info.totalPrice === '174.00' && info.currencyCode === 'USD' &&
    info.totalPriceStatus === 'FINAL';
});

checkAsync('G2  it confirms the order and then uses the SAME settlement',
  async () => {
    const p = page({});
    await settle(); await settle(); await settle();
    await p.press('google-pay');
    await settle(); await settle();
    const gp = p.sessions.filter(function (s) { return s.kind === 'googlepay'; })[0];
    return gp.confirmed === 1 && gp.confirmedWith.orderId === 'ORD-1' &&
      p.bodies('settle').length === 1;
  });

checkAsync('G3  GOOGLE IS TOLD SUCCESS ONLY AFTER CORNERPOST HAS ANSWERED',
  async () => {
    const good = page({});
    await settle(); await settle(); await settle();
    await good.press('google-pay');
    await settle(); await settle();

    const bad = page({ settle: { recorded: false, reason: 'uncertain' } });
    await settle(); await settle(); await settle();
    await bad.press('google-pay');
    await settle(); await settle();

    return good.googlePayResult.transactionState === 'SUCCESS' &&
      bad.googlePayResult.transactionState === 'ERROR';
  });

/* ── The PayPal popup that closed itself ─────────────────────────────── */
section('H  One session per method, and none created on a first load');

/**
 * THE FIELD FAILURE OF 9 SEPTEMBER 2026.
 *
 * On the Cornerpost-hosted page, Venmo and Google Pay opened correctly and
 * PayPal's window opened and closed immediately. The one structural thing
 * that made PayPal different: the page built a PayPal session on EVERY
 * load, purely to ask whether the buyer was returning, and then abandoned
 * it -- so a PayPal click created a SECOND session for the same component.
 * Venmo creates one per click; Google Pay one for the page.
 *
 * The same code ran on the Apps Script host without visible harm, which is
 * consistent with that page sitting inside a sandboxed iframe where
 * presentationMode "auto" cannot use a popup and falls back to a modal. A
 * latent fault that one host happened to mask is still a fault, and an
 * abandoned session is wrong on its own terms.
 */

checkAsync('H1  AN ORDINARY FIRST LOAD CREATES NO PAYPAL SESSION AT ALL. ' +
  'Nothing is built until the customer asks for it.', async () => {
  const p = page({});
  await settle(); await settle(); await settle();
  return p.sessions.filter(function (s) { return s.kind === 'paypal'; })
    .length === 0;
});

checkAsync('H2  ...and pressing PayPal then creates EXACTLY ONE -- the ' +
  'duplicate that made PayPal the odd one out is gone', async () => {
  const p = page({ autoApprove: false });
  await settle(); await settle(); await settle();
  p.press('paypal');
  await settle(); await settle();
  return p.sessions.filter(function (s) { return s.kind === 'paypal'; })
    .length === 1;
});

checkAsync('H3  EACH METHOD CREATES ONE SESSION AND ONLY ITS OWN', async () => {
  const p = page({ autoApprove: false });
  await settle(); await settle(); await settle();
  p.press('venmo');
  await settle(); await settle();
  const kinds = p.sessions.map(function (s) { return s.kind; }).sort();
  /* Google Pay builds its one session while deciding whether the device
     can pay at all, which is the only way to ask. */
  return kinds.join(',') === 'googlepay,venmo';
});

checkAsync('H4  A RETURN-LOOKING URL STILL ASKS. Removing the session from ' +
  'a first load must not remove resume for the buyer it exists for.',
  async () => {
    const p = page({ search: '?t=' + TOKEN + '&token=EC-1&PayerID=ABC' });
    await settle(); await settle(); await settle();
    return p.sessions.filter(function (s) { return s.kind === 'paypal'; })
      .length === 1;
  });

checkAsync('H5  DIAGNOSTICS ARE SILENT unless the URL asks for them, so a ' +
  'customer never sees any of it', async () => {
  const quiet = page({});
  await settle(); await settle(); await settle();
  const loud = page({ search: '?t=' + TOKEN + '&diag=1' });
  await settle(); await settle(); await settle();
  return quiet.logs.length === 0 && loud.logs.length > 0;
});

checkAsync('H6  ...and when they do speak they name STEPS, never content -- ' +
  'no token, no order id, no client id, no amount', async () => {
  const p = page({ search: '?t=' + TOKEN + '&diag=1', autoApprove: false });
  await settle(); await settle(); await settle();
  p.press('paypal');
  await settle(); await settle();
  const all = p.logs.join(' | ');
  return all.length > 0 && all.indexOf(TOKEN) === -1 &&
    all.indexOf('ORD-1') === -1 &&
    all.indexOf('sandbox-client-id') === -1 && all.indexOf('174') === -1;
});

/* ── Runner ──────────────────────────────────────────────────────────── */

(async function () {
  for (let i = 0; i < async_.length; i += 1) {
    const c = async_[i];
    let ok = false, detail = '';
    try { ok = (await c.thunk()) === true; }
    catch (e) { detail = ' [' + String(e && e.message).slice(0, 120) + ']'; }
    if (ok) { pass += 1; console.log('    ok    ' + c.label); }
    else { failures.push(c.label + detail); console.log('    FAIL  ' + c.label + detail); }
  }

  console.log('');
  console.log('  ' + pass + ' passed, ' + failures.length + ' failed');
  if (failures.length) {
    console.log('');
    failures.forEach(function (f) { console.log('    FAILED  ' + f); });
  }
  console.log('');
  process.exit(failures.length ? 1 : 0);
})();
