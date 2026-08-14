#!/usr/bin/env node
/**
 * website-intake-harness.js — Cornerpost Website Intake
 *
 * Runs the real apps-script/Code.gs under `vm` against a simulated Apps
 * Script layer. No build step, no framework, no dependencies — the same
 * conventions as the Service System harnesses in
 * cornerpost-service-system/tests/harness.
 *
 *   node tests/website-intake-harness.js apps-script
 *
 * Exits non-zero on failure and prints `N passed, M failed`.
 *
 * WHAT IS SIMULATED AND WHAT IS NOT. Nothing this file owns is mocked: the
 * validation, normalization, photo rules, payload construction and response
 * shaping are the real ones, read from the real file. The simulated boundary
 * is everything outside the script — Drive, Mail, Properties, and the
 * Service System library, which is replaced by a recorder so the harness can
 * assert exactly what V520 would have been handed.
 *
 * Red-check every new assertion: break the thing it protects, watch it fail,
 * put it back. An assertion that has never failed is a comment.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APPS = process.argv[2] || 'apps-script';
const SRC = fs.readFileSync(path.join(APPS, 'Code.gs'), 'utf8');

let pass = 0;
const failures = [];

/** Source with comments removed. A rule described in prose is not a second
 * implementation of it, and must not be counted as one. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function check(label, condition, detail) {
  /* A thunk is evaluated HERE, inside the guard. Assertion bodies used to be
   * IIFEs evaluated as ARGUMENTS, so a throw escaped before check() ever ran,
   * killing the process and reporting nothing. A regression must fail an
   * assertion, never abort the run. */
  if (typeof condition === 'function') {
    try {
      condition = condition();
    } catch (error) {
      failures.push(label);
      console.log('  FAIL  ' + label + '  ->  threw: ' + (error && error.message));
      return;
    }
  }
  if (condition) {
    pass += 1;
    console.log('  PASS  ' + label);
  } else {
    failures.push(label);
    console.log('  FAIL  ' + label + (detail ? '  ->  ' + detail : ''));
  }
}

function section(title) {
  console.log('\n' + title);
}

/* ── The simulated world ──────────────────────────────────────────────── */

const VALID_KEY = 'WSR-11111111-2222-3333-4444-555555555555';
const PHOTO_FOLDER_ID = 'photo-folder-id';

/** A one-pixel PNG, as the browser would hand it over. */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function world(options) {
  const opt = options || {};
  const sent = [];
  const created = { folders: [], files: [] };
  const logs = [];
  const v520Calls = [];

  /* Drive: folders remember their names so find-or-create is real. */
  const existingFolders = (opt.existingFolders || []).slice();
  function makeFolder(name) {
    const folder = {
      name: name,
      getName: function () { return name; },
      getUrl: function () { return 'https://drive.example/folders/' + encodeURIComponent(name); },
      createFile: function (blob) { created.files.push({ folder: name, blob: blob }); return blob; },
      getFoldersByName: function (n) { return iterator(existingFolders.filter(f => f === n).map(makeFolder)); }
    };
    return folder;
  }
  function iterator(items) {
    let i = 0;
    return { hasNext: function () { return i < items.length; }, next: function () { return items[i++]; } };
  }

  const root = {
    getFoldersByName: function (n) {
      return iterator(existingFolders.filter(f => f === n).map(makeFolder));
    },
    createFolder: function (n) {
      existingFolders.push(n);
      created.folders.push(n);
      return makeFolder(n);
    }
  };

  let locksHeld = 0;
  let maxLocks = 0;

  const properties = Object.assign(
    { WEBSITE_REQUEST_PHOTO_FOLDER_ID: PHOTO_FOLDER_ID },
    opt.properties || {}
  );

  const ctx = {
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: function (text) {
        return { text: text, setMimeType: function () { return this; } };
      }
    },
    PropertiesService: {
      getScriptProperties: function () {
        return {
          getProperty: function (k) {
            return properties[k] === undefined ? null : properties[k];
          }
        };
      }
    },
    DriveApp: {
      getFolderById: function (id) {
        if (id !== PHOTO_FOLDER_ID) throw new Error('no such folder');
        return root;
      }
    },
    MailApp: { sendEmail: function (msg) { sent.push(msg); } },
    LockService: {
      getScriptLock: function () {
        return {
          waitLock: function () { locksHeld += 1; maxLocks = Math.max(maxLocks, locksHeld); },
          releaseLock: function () { locksHeld -= 1; }
        };
      }
    },
    Utilities: {
      base64Decode: function (data) {
        if (opt.decodeThrows) throw new Error('bad base64');
        return Buffer.from(String(data), 'base64');
      },
      newBlob: function (bytes, type, name) { return { bytes: bytes, type: type, name: name }; }
    },
    Session: { getScriptTimeZone: function () { return 'America/Denver'; } },
    /* The Service System library, as a recorder. */
    CornerpostServiceSystem: opt.noLibrary ? undefined : {
      submitWebsiteServiceRequestV520: function (payload) {
        v520Calls.push(payload);
        if (opt.v520) return opt.v520(payload, v520Calls.length);
        return {
          success: true,
          idempotent: v520Calls.length > 1,
          request: { requestNumber: 'SR-20260813-001' }
        };
      }
    },
    console: {
      log: function (m) { logs.push(String(m)); },
      error: function (m) { logs.push('ERROR ' + String(m && m.message ? m.message : m)); }
    },
    JSON: JSON, Math: Math, Number: Number, String: String, Array: Array,
    Object: Object, Error: Error, Date: Date, RegExp: RegExp, Buffer: Buffer,
    isFinite: isFinite, parseInt: parseInt
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'Code.gs' });

  return {
    post: function (params) {
      const out = vm.runInContext('doPost', ctx)({ parameter: params });
      return JSON.parse(out.text);
    },
    get: function () {
      return JSON.parse(vm.runInContext('doGet', ctx)().text);
    },
    fn: function (name) { return vm.runInContext(name, ctx); },
    v520Calls: function () { return v520Calls; },
    sent: function () { return sent; },
    created: function () { return created; },
    logs: function () { return logs; },
    locksHeld: function () { return locksHeld; }
  };
}

const BASE_FORM = {
  submissionKey: VALID_KEY,
  firstName: 'ZZTEST',
  lastName: 'HARNESS',
  phone: '555-555-0199',
  email: 'harness@example.com',
  preferredContact: 'No Preference',
  relationshipType: 'Owner',
  streetAddress: '1 TEST ST',
  address2: '',
  city: 'Sidney',
  state: 'NE',
  zip: '69162',
  billingSameAsService: 'true',
  service: 'Water heater',
  preferredTime: 'Morning',
  message: 'Harness submission.'
};

const form = (overrides) => Object.assign({}, BASE_FORM, overrides || {});

/* The nth payload handed to V520, or an empty one; and the nth stored file,
 * or an empty one. Assertions that read a field off either must FAIL when a
 * regression stops the call happening, not die on the dereference and take
 * the rest of the run with them. Red-checked: this is how R17 reports
 * instead of crashing. */
const call520 = (w, n) => w.v520Calls()[n || 0] || {};
const storedFile = (w, n) => (w.created().files[n || 0] || { blob: {} }).blob;

console.log('\n' + '='.repeat(66));
console.log('  Cornerpost Website Intake — Stage 2 boundary harness');
console.log('='.repeat(66));

/* ── 1. The direct-database implementation is gone ────────────────────── */

section('The parallel database implementation is retired');

check('no SpreadsheetApp use anywhere in the intake',
  SRC.indexOf('SpreadsheetApp') === -1);
check('no openById call anywhere in the intake',
  SRC.indexOf('openById') === -1);
check('the Working database spreadsheet property is never read',
  SRC.indexOf('SERVICE_SYSTEM_SPREADSHEET_ID') === -1);
check('no parallel customer/location/relationship/request writers remain', function () {
  return ['findOrCreateWebsiteCustomer_', 'findOrCreateWebsiteLocation_',
    'findOrCreateWebsiteRelationship_', 'createWebsiteRequestRecord_',
    'createWebsiteServiceRequest_'].every(function (n) { return SRC.indexOf(n) === -1; });
});
check('no parallel request-number generator remains', function () {
  /* Tests for a request number being CONSTRUCTED here -- the 'SR-' prefix
     as a literal, and the date formatting the old generator used. A bare
     substring search would match WSR- inside the submission key pattern and
     assert nothing. */
  return CODE.indexOf('nextRequestNumber_') === -1 &&
    CODE.indexOf("'SR-'") === -1 &&
    CODE.indexOf('Utilities.formatDate') === -1;
});
check('V520 is the only business-record path', function () {
  /* Counted in code, not prose: the header comment names the boundary too,
     and describing it is not calling it twice. */
  return (CODE.split('submitWebsiteServiceRequestV520(').length - 1) === 1 &&
    CODE.indexOf('CornerpostServiceSystem.submitWebsiteServiceRequestV520(') !== -1;
});
check('the legacy Service System entry points are not called',
  SRC.indexOf('submitWebsiteServiceRequest(') === -1 &&
  SRC.indexOf('validateWebsiteIntakeConnection') === -1);

/* ── 2. SubmissionKey ─────────────────────────────────────────────────── */

section('SubmissionKey');

check('a valid submission reaches V520 exactly once', function () {
  const w = world({});
  const r = w.post(form());
  return r.success === true && w.v520Calls().length === 1;
});
check('the key is passed to V520 unchanged', function () {
  const w = world({});
  w.post(form());
  return call520(w, 0).submissionKey === VALID_KEY;
});
check('a missing key is refused, and V520 is never called', function () {
  const w = world({});
  const r = w.post(form({ submissionKey: '' }));
  return r.success === false && w.v520Calls().length === 0 &&
    r.error.indexOf('submission key') !== -1;
});
check('a malformed key is refused, and V520 is never called', function () {
  const bad = ['not-a-key', 'WSR-123', '11111111-2222-3333-4444-555555555555',
    'WSR-11111111-2222-3333-4444-55555555555'];
  return bad.every(function (k) {
    const w = world({});
    const r = w.post(form({ submissionKey: k }));
    return r.success === false && w.v520Calls().length === 0;
  });
});
/* EACH GUARD PINNED SEPARATELY. The format check refuses an empty key too,
 * so the "missing" branch passes even with its own guard deleted -- defence
 * in depth working, and also how a layer rots unnoticed. The two branches
 * say different things to the customer, so asserting the MESSAGE pins each
 * one independently. */
check('...a missing key and a malformed key are told apart', function () {
  const w = world({});
  return w.post(form({ submissionKey: '' })).error ===
      'This request is missing its submission key. Please reload the page and try again.' &&
    w.post(form({ submissionKey: 'nope' })).error ===
      'This request has an invalid submission key. Please reload the page and try again.';
});
check('the intake NEVER invents a key of its own', function () {
  /* A server-side fallback would silently reintroduce the duplicate this
     whole mechanism exists to prevent. */
  const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  return stripped.indexOf('Utilities.getUuid') === -1 &&
    stripped.indexOf('randomUUID') === -1 &&
    !/submissionKey\s*[:=][^,;\n]*\|\|/.test(stripped);
});
check('the same key twice creates nothing extra downstream', function () {
  const w = world({});
  const a = w.post(form());
  const b = w.post(form());
  return a.requestNumber === b.requestNumber && w.v520Calls().length === 2 &&
    call520(w, 0).submissionKey === call520(w, 1).submissionKey;
});

/* ── 3. Photos ────────────────────────────────────────────────────────── */

section('Photos');

const onePhoto = JSON.stringify([{ name: 'a.png', type: 'image/png', data: TINY_PNG_B64 }]);

check('a photo is stored and its folder URL goes to V520', function () {
  const w = world({});
  w.post(form({ photos: onePhoto }));
  return w.created().folders.length === 1 && w.created().files.length === 1 &&
    /^https:\/\/drive\.example\/folders\//.test(call520(w, 0).photoFolderUrl);
});
check('the folder is named for the submission key', function () {
  const w = world({});
  w.post(form({ photos: onePhoto }));
  /* Guarded: a regression that stops the submission creating anything must
     fail this assertion, not die indexing an empty array. */
  return (w.created().folders[0] || '').indexOf(VALID_KEY) !== -1;
});
check('a replay re-uses the same folder and uploads nothing again', function () {
  const w = world({});
  w.post(form({ photos: onePhoto }));
  w.post(form({ photos: onePhoto }));
  return w.created().folders.length === 1 && w.created().files.length === 1 &&
    call520(w, 0).photoFolderUrl === call520(w, 1).photoFolderUrl;
});
check('a different key gets a different folder', function () {
  const w = world({});
  w.post(form({ photos: onePhoto }));
  w.post(form({ submissionKey: 'WSR-99999999-2222-3333-4444-555555555555', photos: onePhoto }));
  return w.created().folders.length === 2;
});
check('more than three photos is refused', function () {
  const many = JSON.stringify([1, 2, 3, 4].map(function () {
    return { name: 'a.png', type: 'image/png', data: TINY_PNG_B64 };
  }));
  const w = world({});
  const r = w.post(form({ photos: many }));
  return r.success === false && w.v520Calls().length === 0 &&
    r.error.indexOf('up to 3 photos') !== -1;
});
check('a non-image MIME type is refused', function () {
  const w = world({});
  const r = w.post(form({
    photos: JSON.stringify([{ name: 'x.exe', type: 'application/x-msdownload', data: TINY_PNG_B64 }])
  }));
  return r.success === false && w.v520Calls().length === 0 &&
    r.error.indexOf('JPEG, PNG') !== -1;
});
check('an oversized photo is refused before it is decoded', function () {
  const huge = 'A'.repeat(8 * 1024 * 1024);
  const w = world({});
  const r = w.post(form({
    photos: JSON.stringify([{ name: 'big.png', type: 'image/png', data: huge }])
  }));
  return r.success === false && w.v520Calls().length === 0 &&
    r.error.indexOf('5 MB') !== -1;
});
check('...and the size is judged BEFORE decoding, not only after', function () {
  /* Decoding is made to throw, so only the pre-decode length check can
     produce the size message. Without this, deleting that check still
     passes because the post-decode check catches the same photo. */
  const w = world({ decodeThrows: true });
  const huge = 'A'.repeat(8 * 1024 * 1024);
  const r = w.post(form({
    photos: JSON.stringify([{ name: 'big.png', type: 'image/png', data: huge }])
  }));
  return r.success === false && r.error.indexOf('5 MB') !== -1;
});
check('unparseable photo JSON is refused, not ignored', function () {
  const w = world({});
  const r = w.post(form({ photos: '{not json' }));
  return r.success === false && w.v520Calls().length === 0;
});
check('the file name cannot carry a path', function () {
  const w = world({});
  w.post(form({
    photos: JSON.stringify([{ name: '../../etc/passwd', type: 'image/png', data: TINY_PNG_B64 }])
  }));
  /* A stored file must exist AND its name must be safe. Defaulting the name
     to '' would let a regression that stores nothing pass this silently. */
  const name = storedFile(w, 0).name;
  return typeof name === 'string' && name.length > 0 &&
    name.indexOf('/') === -1 && name.indexOf('..') === -1;
});
check('the caller cannot choose the Drive destination', function () {
  /* The folder comes from Script Properties and nothing else. */
  const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  return /getFolderById\(\s*folderId\s*\)/.test(stripped) &&
    stripped.indexOf('data.folder') === -1 &&
    stripped.indexOf('input.folder') === -1;
});
check('no photos means no folder and no Drive call', function () {
  const w = world({});
  w.post(form());
  return w.created().folders.length === 0 && call520(w, 0).photoFolderUrl === '';
});
check('the photo lock is always released', function () {
  const w = world({});
  w.post(form({ photos: onePhoto }));
  return w.locksHeld() === 0;
});

/* ── 4. The public response ───────────────────────────────────────────── */

section('The public response');

check('success returns exactly {success, requestNumber}', function () {
  const w = world({});
  const r = w.post(form());
  return Object.keys(r).sort().join(',') === 'requestNumber,success' &&
    r.requestNumber === 'SR-20260813-001';
});
check('failure returns exactly {success, error}', function () {
  const w = world({});
  const r = w.post(form({ firstName: '' }));
  return Object.keys(r).sort().join(',') === 'error,success';
});
check('a submitter still learns what THEY can fix', function () {
  const w = world({});
  return w.post(form({ firstName: '' })).error === 'First name is required.' &&
    w.post(form({ email: 'nope' })).error === 'Enter a valid email address.' &&
    w.post(form({ relationshipType: '' })).error ===
      'Select whether you own or rent the property.';
});
check('an internal failure never reaches the public response', function () {
  const w = world({ noLibrary: true });   /* library unavailable */
  const r = w.post(form());
  return r.success === false &&
    r.error === 'Your request could not be submitted. Please try again, or call us and we will take the details over the phone.';
});
check('...and a Drive failure is equally opaque', function () {
  const w = world({ properties: { WEBSITE_REQUEST_PHOTO_FOLDER_ID: '' } });
  const r = w.post(form({ photos: onePhoto }));
  return r.success === false &&
    r.error.indexOf('photo storage') === -1 &&
    r.error.indexOf('configured') === -1;
});
check('no identifier of any kind leaks into the public response', function () {
  const w = world({});
  const text = JSON.stringify(w.post(form({ photos: onePhoto })));
  const uuid = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
  return !uuid.test(text) && text.indexOf('drive.example') === -1 &&
    text.indexOf('customerId') === -1 && text.indexOf('locationId') === -1 &&
    text.indexOf(PHOTO_FOLDER_ID) === -1;
});
check('V520 refusals are passed through, already sanitized', function () {
  const w = world({ v520: function () {
    return { success: false, error: 'A submission key is required.' };
  } });
  const r = w.post(form());
  return r.success === false && r.error === 'A submission key is required.';
});

/* ── 5. doGet exposes nothing ─────────────────────────────────────────── */

section('The public doGet');

check('doGet exposes no infrastructure identifiers', function () {
  const w = world({});
  const text = JSON.stringify(w.get());
  return text.indexOf('spreadsheet') === -1 && text.indexOf('Spreadsheet') === -1 &&
    text.indexOf('scriptId') === -1 && text.indexOf(PHOTO_FOLDER_ID) === -1;
});
check('...and does not touch the database or Drive at all', function () {
  const body = SRC.slice(SRC.indexOf('function doGet'), SRC.indexOf('function doPost'));
  return body.indexOf('DriveApp') === -1 && body.indexOf('Properties') === -1 &&
    body.indexOf('ScriptApp') === -1;
});
check('...and returns something useful', function () {
  return world({}).get().success === true;
});

/* ── 6. Spam control and notifications ────────────────────────────────── */

section('Spam control and notifications');

check('the honeypot still creates nothing and reveals nothing', function () {
  const w = world({});
  const r = w.post(form({ companyWebsite: 'http://spam.example' }));
  return r.success === true && w.v520Calls().length === 0 &&
    w.sent().length === 0 && Object.keys(r).join(',') === 'success';
});
check('a created request notifies the office and the customer', function () {
  const w = world({});
  w.post(form());
  return w.sent().length === 2;
});
check('the office email carries the request number and no internal UUIDs', function () {
  const w = world({});
  w.post(form());
  const office = w.sent().filter(function (m) { return m.to.indexOf('Cornerpost') !== -1; })[0];
  return office.body.indexOf('SR-20260813-001') !== -1 &&
    ['CustomerID', 'LocationID', 'RelationshipID', 'RequestID']
      .every(function (k) { return office.body.indexOf(k) === -1; });
});
check('a replay says plainly that it is a replay', function () {
  const w = world({});
  w.post(form());
  w.post(form());
  const last = w.sent()[w.sent().length - 2];
  return last.subject.indexOf('Resubmitted') !== -1;
});
check('no confirmation is sent when no email was given', function () {
  const w = world({});
  w.post(form({ email: '' }));
  return w.sent().length === 1;
});
check('nothing is emailed when the request was refused', function () {
  const w = world({});
  w.post(form({ message: '' }));
  return w.sent().length === 0;
});

/* ── 7. The payload handed to the Service System ──────────────────────── */

section('The payload handed to the Service System');

check('every V520 field is supplied and nothing else is', function () {
  const w = world({});
  w.post(form());
  const keys = Object.keys(call520(w, 0)).sort().join(',');
  return keys === [
    'billingAddress1', 'billingAddress2', 'billingCity', 'billingState', 'billingZip',
    'email', 'firstName', 'lastName', 'message', 'phone', 'photoFolderUrl',
    'preferredContact', 'preferredTime', 'relationshipType', 'service',
    'serviceAddress1', 'serviceCity', 'serviceState', 'serviceZip', 'serviceAddress2',
    'submissionKey'
  ].sort().join(',');
}, Object.keys(world({}).fn('buildServiceSystemPayload_')({ photos: [] }, '')).sort().join(','));
check('no infrastructure value is ever put in the payload', function () {
  const w = world({});
  w.post(form({ photos: onePhoto }));
  const text = JSON.stringify(call520(w, 0));
  return text.indexOf(PHOTO_FOLDER_ID) === -1 &&
    text.indexOf('spreadsheet') === -1 && text.indexOf('scriptId') === -1;
});
check('the website field names are translated to the V520 contract', function () {
  const w = world({});
  w.post(form());
  const p = call520(w, 0);
  return p.serviceAddress1 === '1 TEST ST' && p.serviceCity === 'Sidney' &&
    p.serviceState === 'NE' && p.serviceZip === '69162';
});
check('billingSameAsService is expanded before the call', function () {
  const w = world({});
  w.post(form());
  const p = call520(w, 0);
  return p.billingAddress1 === '1 TEST ST' && p.billingCity === 'Sidney' &&
    p.billingZip === '69162';
});
check('the honeypot field is never forwarded', function () {
  const w = world({});
  w.post(form({ companyWebsite: '' }));
  return call520(w, 0).companyWebsite === undefined;
});

/* ── Result ───────────────────────────────────────────────────────────── */

console.log('\n' + '='.repeat(66));
console.log('  ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('\n  FAILURES:');
  failures.forEach(f => console.log('    - ' + f));
}
console.log('='.repeat(66) + '\n');
process.exit(failures.length ? 1 : 0);
