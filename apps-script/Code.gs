/** Cornerpost Plumbing public website intake endpoint. */
const SERVICE_EMAIL = 'Service@CornerpostPlumbing.com';
const DATABASE_ID_PROPERTY = 'SERVICE_SYSTEM_SPREADSHEET_ID';
const PHOTO_FOLDER_ID_PROPERTY = 'WEBSITE_REQUEST_PHOTO_FOLDER_ID';

function doPost(e) {
  try {
    const data = (e && e.parameter) || {};
    if (clean_(data.companyWebsite)) return jsonResponse_({ success: true });

    const input = normalizeWebsiteRequest_(data);
    validateWebsiteRequest_(input);
    const now = new Date();
    input.photoFolderUrl = saveRequestPhotos_(input, now);

    const spreadsheetId = clean_(PropertiesService.getScriptProperties().getProperty(DATABASE_ID_PROPERTY));
    if (!spreadsheetId) throw new Error('Service System database integration has not been configured.');

    const result = CornerpostService.submitWebsiteServiceRequest(input, { spreadsheetId: spreadsheetId });
    result.photoFolderUrl = input.photoFolderUrl;
    sendInternalNotification_(input, result);
    sendCustomerConfirmation_(input, result);
    return jsonResponse_({ success: true, requestNumber: result.requestNumber });
  } catch (error) {
    console.error(error);
    return jsonResponse_({ success: false, error: error && error.message ? error.message : String(error) });
  }
}

function testServiceSystemLibraryConnection() {
  const spreadsheetId = clean_(PropertiesService.getScriptProperties().getProperty(DATABASE_ID_PROPERTY));
  return CornerpostService.validateWebsiteIntakeConnection(spreadsheetId);
}

function saveRequestPhotos_(input, now) {
  if (!input.photos.length) return '';

  const folderId = clean_(PropertiesService.getScriptProperties().getProperty(PHOTO_FOLDER_ID_PROPERTY));
  if (!folderId || folderId.indexOf('PASTE_') === 0) {
    throw new Error('Website request photo storage has not been configured.');
  }

  const root = DriveApp.getFolderById(folderId);
  const timezone = Session.getScriptTimeZone() || 'America/Denver';
  const folderName = Utilities.formatDate(now, timezone, 'yyyy-MM-dd HHmmss') +
    ' - ' + input.lastName + ', ' + input.firstName;
  const folder = root.createFolder(folderName);

  input.photos.forEach(function (photo) {
    const bytes = Utilities.base64Decode(photo.data);
    const blob = Utilities.newBlob(bytes, photo.type, photo.name);
    folder.createFile(blob);
  });

  return folder.getUrl();
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

function validateWebsiteRequest_(input) {
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

function sendInternalNotification_(input, result) {
  const subject = 'New Website Service Request - ' + result.requestNumber;
  const body = [
    'New website service request',
    '',
    'Reference: ' + result.requestNumber,
    'Customer: ' + input.firstName + ' ' + input.lastName,
    'Relationship: ' + input.relationshipType,
    'Phone: ' + input.phone,
    'Email: ' + (input.email || 'Not provided'),
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
    '',
    'Database records created or matched:',
    'CustomerID: ' + result.customerId,
    'LocationID: ' + result.locationId,
    'RelationshipID: ' + result.relationshipId,
    'RequestID: ' + result.requestId,
    result.photoFolderUrl ? 'Photos: ' + result.photoFolderUrl : ''
  ].filter(function (line) { return line !== ''; }).join('\n');

  MailApp.sendEmail({
    to: SERVICE_EMAIL,
    subject: subject,
    body: body,
    replyTo: input.email || undefined
  });
}

function sendCustomerConfirmation_(input, result) {
  if (!input.email) return;

  const subject = 'Cornerpost Plumbing Service Request ' + result.requestNumber;
  const body = [
    'Hello ' + input.firstName + ',',
    '',
    'We received your service request. Your reference number is ' + result.requestNumber + '.',
    '',
    'Requested service: ' + input.service,
    'Service address: ' + input.serviceAddress1 + ', ' + input.serviceCity + ', ' + input.serviceState + ' ' + input.serviceZip,
    '',
    'We will review the information and contact you about the appropriate next step.',
    '',
    'Cornerpost Plumbing',
    'Honest Recommendations. Quality Craftsmanship.',
    '308-225-3392'
  ].join('\n');

  MailApp.sendEmail({
    to: input.email,
    subject: subject,
    body: body,
    replyTo: SERVICE_EMAIL
  });
}

function parsePhotos_(value) {
  if (!value) return [];
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) return [];

  return parsed.slice(0, 3).map(function (photo) {
    return {
      name: clean_(photo.name) || 'request-photo',
      type: clean_(photo.type) || 'application/octet-stream',
      data: clean_(photo.data)
    };
  }).filter(function (photo) { return photo.data; });
}


function clean_(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}


function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


