/**
 * Cornerpost Plumbing public website service-request intake.
 *
 * This script is the public boundary. It is deliberately separate from the
 * private Cornerpost Service System, and it no longer writes business
 * records itself.
 *
 * THE WEBSITE ASKS. THE SERVICE SYSTEM DECIDES. Until 5.2.0 this file
 * carried its own copy of customer matching, location matching,
 * relationship creation and request numbering, and wrote them straight
 * into the Working database with a spreadsheet ID it held in its own Script
 * Properties. That was a second implementation of business rules that
 * already existed, kept in step by hand, and it is what allowed a browser
 * retry to create a second customer and a second service request. All of it
 * is gone. This file now collects, validates, stores photos, and hands the
 * submission to the approved Service System boundary:
 *
 *   CornerpostServiceSystem.submitWebsiteServiceRequestV520(payload)
 *
 * The Service System resolves the Working database from its own
 * configuration, verifies it, and owns every business record decision. This
 * script never learns which spreadsheet that is, and has no way to choose
 * one.
 *
 * WHAT STAYS HERE: public input quality, spam control, photo transport, the
 * notification emails, and a public response that says as little as it can.
 */

const SERVICE_EMAIL = 'Service@CornerpostPlumbing.com';
const PHOTO_FOLDER_ID_PROPERTY = 'WEBSITE_REQUEST_PHOTO_FOLDER_ID';
const WEBSITE_INTAKE_BUILD = '2026-08-13.1';

/**
 * The submission key format the Service System requires.
 *
 * IT IS AN IDEMPOTENCY KEY, NOT A SECRET. It exists so that one customer
 * action becomes one service request however many times the browser has to
 * ask. It authenticates nothing and authorizes nothing: anyone can POST any
 * key they like, and the worst they achieve is either an ordinary new
 * request or the request number of a request they already know the key for.
 * Spam control is the honeypot and the office's own eyes, not this value.
 */
const SUBMISSION_KEY_PATTERN =
  /^WSR-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/* Photo limits. THE BROWSER'S CHECKS ARE A COURTESY, NOT A BOUNDARY -- a
 * caller can post here directly and never load the website at all, so every
 * limit the form advertises is enforced again on this side. */
const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = [
  'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'image/gif'
];

/** Exactly the messages this script raises for a submitter to act on. */
const PUBLIC_INTAKE_MESSAGES = [
  'First name is required.',
  'Last name is required.',
  'Phone is required.',
  'Enter a valid email address.',
  'Select whether you own or rent the property.',
  'Complete the service address.',
  'Service state must use a two-letter abbreviation.',
  'Enter a valid service ZIP code.',
  'Complete the billing address.',
  'Select the service needed.',
  'Describe the requested work.',
  'This request is missing its submission key. Please reload the page and try again.',
  'This request has an invalid submission key. Please reload the page and try again.',
  'You can attach up to 3 photos.',
  'Each photo must be 5 MB or smaller.',
  'Photos must be JPEG, PNG, HEIC, WebP or GIF images.',
  'One of the attached photos could not be read.'
];

const GENERIC_PUBLIC_ERROR =
  'Your request could not be submitted. Please try again, or call us and we will take the details over the phone.';


/**
 * Liveness only.
 *
 * This used to answer with the Working database's spreadsheet ID, its name
 * and this project's script ID, on an endpoint anyone on the internet can
 * call. A public caller has no use for any of that and an attacker has an
 * obvious one. Whether the endpoint is reachable is the only question a
 * stranger gets an answer to.
 */
function doGet() {
  return jsonResponse_({ success: true, service: 'Cornerpost Website Intake' });
}


function doPost(e) {
  try {
    const data = (e && e.parameter) || {};
    console.log('[Website Intake ' + WEBSITE_INTAKE_BUILD + '] doPost started');

    /* Honeypot. A real browser leaves this field empty because it is hidden;
     * a bot fills everything it finds. Answer as though it worked, so the
     * bot learns nothing, and create nothing. */
    if (clean_(data.companyWebsite)) {
      console.log('[Website Intake] honeypot triggered; no record created');
      return jsonResponse_({ success: true });
    }

    const input = normalizeWebsiteRequest_(data);
    validateWebsiteRequest_(input);

    /* PHOTOS BEFORE THE CALL, AND OUTSIDE ANY BUSINESS LOCK. The Service
     * System takes a finished folder URL as ordinary request data and does
     * no Drive work of its own -- deliberately, so nothing slow runs inside
     * the lock that protects the database. The folder is derived from the
     * submission key, so a retry re-uses the folder the first attempt made
     * rather than leaving a second one behind. */
    const photos = saveRequestPhotos_(input);
    const photoFolderUrl = photos.url;

    const result = CornerpostServiceSystem.submitWebsiteServiceRequestV520(
      buildServiceSystemPayload_(input, photoFolderUrl)
    );

    /* The Service System has already reduced its failures to something fit
     * for a public caller, so its message is passed straight through. */
    if (!result || result.success !== true) {
      const message = (result && result.error) || GENERIC_PUBLIC_ERROR;
      console.error('[Website Intake] V520 refused the submission: ' + message);
      return jsonResponse_({ success: false, error: message });
    }

    const requestNumber = result.request.requestNumber;
    console.log('[Website Intake] ' + requestNumber +
      (result.idempotent ? ' (replay of an existing request)' : ' (created)'));

    /* NOTIFY ON A REPLAY TOO. A replay means the record exists, not that the
     * customer was ever told about it: the first attempt may have committed
     * and then died before it could send anything, which is precisely the
     * case the retry exists to repair. A second confirmation is a small
     * annoyance; silence after a request that really was received is not.
     * The office copy says plainly that it is a retry, so nobody reads two
     * emails as two jobs. */
    /* PHOTOS THAT ARRIVED FOR A REQUEST THAT ALREADY EXISTED.
     *
     * A replay returns the request the first attempt created, and the
     * Service System does not rewrite that record -- correctly, since it
     * owns it. So if the customer attached photos only on the retry, the
     * folder now exists but the request row still points nowhere.
     *
     * The website must NOT reach into ServiceRequests to fix that; owning
     * business records is precisely what it just gave up. What it can do is
     * refuse to be silent: the office copy says so and carries the link, and
     * the folder is named for the submission key that is stored on the row,
     * so the two can always be matched by hand. */
    const photosNeedAttention = result.idempotent === true && photos.created === true &&
      photoFolderUrl !== '';
    if (photosNeedAttention) {
      console.log('[Website Intake] photos arrived on a replay of ' + requestNumber +
        '; the request record cannot be updated from here');
    }

    sendInternalNotification_(input, requestNumber, photoFolderUrl, result.idempotent,
      photosNeedAttention);
    sendCustomerConfirmation_(input, requestNumber);

    return jsonResponse_({ success: true, requestNumber: requestNumber });
  } catch (error) {
    /* The message only, and only when this script raised it deliberately.
     * Anything thrown from deeper -- a missing library, a Drive failure --
     * describes our infrastructure and becomes one neutral sentence. The
     * detail still reaches the execution log, where it belongs. */
    console.error(error);
    return jsonResponse_({ success: false, error: publicError_(error) });
  }
}


/**
 * The submission, in the shape the Service System accepts.
 *
 * Everything here is customer or business data. There is no spreadsheet ID,
 * no folder ID and no configuration of any kind, because the boundary takes
 * a payload and nothing else -- there is no parameter through which this
 * script, or anyone posting to it, could name a database.
 */
function buildServiceSystemPayload_(input, photoFolderUrl) {
  return {
    submissionKey: input.submissionKey,
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone,
    email: input.email,
    preferredContact: input.preferredContact,
    relationshipType: input.relationshipType,
    serviceAddress1: input.serviceAddress1,
    serviceAddress2: input.serviceAddress2,
    serviceCity: input.serviceCity,
    serviceState: input.serviceState,
    serviceZip: input.serviceZip,
    billingAddress1: input.billingAddress1,
    billingAddress2: input.billingAddress2,
    billingCity: input.billingCity,
    billingState: input.billingState,
    billingZip: input.billingZip,
    service: input.service,
    preferredTime: input.preferredTime,
    message: input.message,
    photoFolderUrl: photoFolderUrl
  };
}


function normalizeWebsiteRequest_(data) {
  const billingSame = clean_(data.billingSameAsService).toLowerCase() === 'true' ||
    clean_(data.billingSameAsService).toLowerCase() === 'on';
  const serviceAddress1 = clean_(data.streetAddress);
  const serviceAddress2 = clean_(data.address2);
  const serviceCity = clean_(data.city);
  const serviceState = clean_(data.state).toUpperCase();
  const serviceZip = clean_(data.zip);

  return {
    submissionKey: clean_(data.submissionKey),
    firstName: clean_(data.firstName),
    lastName: clean_(data.lastName),
    phone: clean_(data.phone),
    email: clean_(data.email).toLowerCase(),
    preferredContact: clean_(data.preferredContact) || 'No Preference',
    relationshipType: clean_(data.relationshipType),
    serviceAddress1: serviceAddress1,
    serviceAddress2: serviceAddress2,
    serviceCity: serviceCity,
    serviceState: serviceState,
    serviceZip: serviceZip,
    billingAddress1: billingSame ? serviceAddress1 : clean_(data.billingAddress1),
    billingAddress2: billingSame ? serviceAddress2 : clean_(data.billingAddress2),
    billingCity: billingSame ? serviceCity : clean_(data.billingCity),
    billingState: billingSame ? serviceState : clean_(data.billingState).toUpperCase(),
    billingZip: billingSame ? serviceZip : clean_(data.billingZip),
    service: clean_(data.service),
    preferredTime: clean_(data.preferredTime),
    message: clean_(data.message),
    photos: parsePhotos_(data.photos)
  };
}


/**
 * Public input quality.
 *
 * These rules are stricter than the Service System's on purpose. A public
 * form should refuse a malformed email address and an incomplete billing
 * address while the customer is still looking at the screen and can fix
 * them. The Service System's own validation is not a duplicate of this one
 * and is not weakened by it: it protects record integrity for every caller,
 * including callers that are not this form.
 */
function validateWebsiteRequest_(input) {
  if (!input.submissionKey) {
    throw new Error('This request is missing its submission key. Please reload the page and try again.');
  }
  if (!SUBMISSION_KEY_PATTERN.test(input.submissionKey)) {
    throw new Error('This request has an invalid submission key. Please reload the page and try again.');
  }
  if (!input.firstName) throw new Error('First name is required.');
  if (!input.lastName) throw new Error('Last name is required.');
  if (!input.phone) throw new Error('Phone is required.');
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    throw new Error('Enter a valid email address.');
  }
  if (!['Owner', 'Tenant'].includes(input.relationshipType)) {
    throw new Error('Select whether you own or rent the property.');
  }
  if (!input.serviceAddress1 || !input.serviceCity || !input.serviceState || !input.serviceZip) {
    throw new Error('Complete the service address.');
  }
  if (!/^[A-Z]{2}$/.test(input.serviceState)) {
    throw new Error('Service state must use a two-letter abbreviation.');
  }
  if (!/^\d{5}(-\d{4})?$/.test(input.serviceZip)) {
    throw new Error('Enter a valid service ZIP code.');
  }
  if (!input.billingAddress1 || !input.billingCity || !input.billingState || !input.billingZip) {
    throw new Error('Complete the billing address.');
  }
  if (!input.service) throw new Error('Select the service needed.');
  if (!input.message) throw new Error('Describe the requested work.');
}


/**
 * The attached photos, or a refusal.
 *
 * Every limit the form advertises is checked here as well, because the form
 * is not in the request path of anyone who chooses not to use it. Count,
 * decoded size and declared type are all rejected rather than trimmed --
 * silently dropping a fourth photo would tell a customer their picture was
 * received when it was not.
 */
function parsePhotos_(value) {
  if (!value) return [];

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error('One of the attached photos could not be read.');
  }
  if (!Array.isArray(parsed)) return [];
  if (parsed.length > MAX_PHOTOS) throw new Error('You can attach up to 3 photos.');

  return parsed.map(function (photo) {
    const type = clean_(photo && photo.type).toLowerCase();
    const data = clean_(photo && photo.data);

    if (!data) throw new Error('One of the attached photos could not be read.');
    if (ALLOWED_PHOTO_TYPES.indexOf(type) === -1) {
      throw new Error('Photos must be JPEG, PNG, HEIC, WebP or GIF images.');
    }

    /* Base64 carries about three bytes for every four characters. Checked
     * before decoding, so an oversized attachment is refused rather than
     * expanded into memory first. */
    if (Math.floor(data.length * 3 / 4) > MAX_PHOTO_BYTES) {
      throw new Error('Each photo must be 5 MB or smaller.');
    }

    let bytes;
    try {
      bytes = Utilities.base64Decode(data);
    } catch (error) {
      throw new Error('One of the attached photos could not be read.');
    }
    if (bytes.length > MAX_PHOTO_BYTES) {
      throw new Error('Each photo must be 5 MB or smaller.');
    }

    return { name: safePhotoName_(photo && photo.name), type: type, bytes: bytes };
  });
}


/**
 * A file name we are willing to create.
 *
 * The name arrives from the browser and is used to create a Drive file, so
 * it is reduced to characters that cannot travel anywhere: no separators,
 * no leading dots, nothing that could read as a path.
 */
function safePhotoName_(value) {
  const cleaned = clean_(value)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 80);
  return cleaned || 'request-photo';
}


/**
 * One logical submission, one photo folder.
 *
 * THE FOLDER IS NAMED FOR THE SUBMISSION KEY, AND NOTHING ELSE. The key is
 * immutable for one logical submission; the customer's name and address are
 * mutable description. An identity built from mutable data is not an
 * identity -- if somebody corrected a typo in their surname between a failed
 * attempt and a retry, a name-based folder would no longer be found and the
 * retry would store a second copy of the same pictures. The key cannot
 * change, so the lookup cannot miss.
 *
 * It also makes the folder traceable in both directions with no index: the
 * folder name is exactly the value stored in ServiceRequests.SubmissionKey
 * for the request it belongs to, so either one finds the other by search.
 *
 * FIRST UPLOAD WINS. If the folder already exists this returns it untouched
 * and stores nothing further: a retry is the same submission being sent
 * again, not an edit of it. Photos added, removed or replaced on a retry are
 * therefore NOT applied. That is deliberate -- the alternative is a
 * synchronisation problem (same file name, different bytes: which is
 * correct?) that this system has no reason to own.
 *
 * The lock is this project's own and guards only the find-or-create, so two
 * submissions arriving together cannot both decide the folder is missing.
 * It is not the Service System's lock and does not hold up the database.
 *
 * @return {Object} {url, created} -- created is true only when THIS
 *     execution made the folder, which the caller needs in order to notice
 *     photos arriving for a request that already exists.
 */
function saveRequestPhotos_(input) {
  if (!input.photos.length) return { url: '', created: false };

  const folderId = clean_(PropertiesService.getScriptProperties().getProperty(PHOTO_FOLDER_ID_PROPERTY));
  if (!folderId || folderId.indexOf('PASTE_') === 0) {
    throw new Error('Website request photo storage has not been configured.');
  }

  const root = DriveApp.getFolderById(folderId);
  const folderName = input.submissionKey;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const existing = root.getFoldersByName(folderName);
    if (existing.hasNext()) {
      console.log('[Website Intake] re-using the existing photo folder for this submission key');
      return { url: existing.next().getUrl(), created: false };
    }

    const folder = root.createFolder(folderName);
    input.photos.forEach(function (photo) {
      folder.createFile(Utilities.newBlob(photo.bytes, photo.type, photo.name));
    });
    return { url: folder.getUrl(), created: true };
  } finally {
    lock.releaseLock();
  }
}


/**
 * The office copy.
 *
 * SR-YYYYMMDD-NNN is the operational reference and the only identifier here.
 * This used to print CustomerID, LocationID, RelationshipID and RequestID;
 * the Service System no longer hands those to a public caller, and the
 * office has never needed them -- the request number finds the record.
 */
function sendInternalNotification_(input, requestNumber, photoFolderUrl, isReplay,
  photosNeedAttention) {
  const subject = (photosNeedAttention
    ? 'Photos added to Website Service Request - '
    : isReplay
      ? 'Resubmitted Website Service Request - '
      : 'New Website Service Request - ') + requestNumber;

  const body = [
    photosNeedAttention
      ? 'A customer resubmitted this request WITH PHOTOS after it had already been ' +
        'created. No new request was created, and the photo link below is NOT on the ' +
        'request record -- please attach it by hand if it matters.'
      : isReplay
        ? 'A customer resubmitted a request that already exists. No new request was created.'
        : 'New website service request',
    '',
    'Reference: ' + requestNumber,
    'Customer: ' + input.firstName + ' ' + input.lastName,
    'Relationship: ' + input.relationshipType,
    'Phone: ' + input.phone,
    'Email: ' + (input.email || 'Not provided'),
    'Preferred contact: ' + input.preferredContact,
    '',
    'Service address:',
    input.serviceAddress1,
    input.serviceAddress2,
    input.serviceCity + ', ' + input.serviceState + ' ' + input.serviceZip,
    '',
    'Requested service: ' + input.service,
    'Preferred time: ' + (input.preferredTime || 'Not specified'),
    '',
    'Details:',
    input.message,
    photoFolderUrl ? 'Photos: ' + photoFolderUrl : ''
  ].filter(function (line) { return line !== ''; }).join('\n');

  MailApp.sendEmail({
    to: SERVICE_EMAIL,
    subject: subject,
    body: body,
    replyTo: input.email || undefined
  });
}


function sendCustomerConfirmation_(input, requestNumber) {
  if (!input.email) return;

  const body = [
    'Hello ' + input.firstName + ',',
    '',
    'We received your service request. Your reference number is ' + requestNumber + '.',
    '',
    'Requested service: ' + input.service,
    'Service address: ' + input.serviceAddress1 + ', ' + input.serviceCity + ', ' +
      input.serviceState + ' ' + input.serviceZip,
    '',
    'We will review the information and contact you about the appropriate next step.',
    '',
    'Cornerpost Plumbing',
    'Honest Recommendations. Quality Craftsmanship.',
    '308-225-3392'
  ].join('\n');

  MailApp.sendEmail({
    to: input.email,
    subject: 'Cornerpost Plumbing Service Request ' + requestNumber,
    body: body,
    replyTo: SERVICE_EMAIL
  });
}


/** A message safe to show a member of the public. */
function publicError_(error) {
  const message = clean_(error && error.message);
  return PUBLIC_INTAKE_MESSAGES.indexOf(message) !== -1 ? message : GENERIC_PUBLIC_ERROR;
}


function clean_(value) {
  return String(value == null ? '' : value).trim();
}


function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}