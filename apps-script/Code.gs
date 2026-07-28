/**
 * Cornerpost Plumbing public website service-request intake.
 *
 * This script is intentionally separate from the private Cornerpost Service
 * System web app. It writes approved intake records directly to the Working
 * database using a spreadsheet ID stored in Script Properties.
 */

const SERVICE_EMAIL = 'Service@CornerpostPlumbing.com';
const DATABASE_ID_PROPERTY = 'SERVICE_SYSTEM_SPREADSHEET_ID';
const PHOTO_FOLDER_ID_PROPERTY = 'WEBSITE_REQUEST_PHOTO_FOLDER_ID';
const UPDATED_BY = 'Cornerpost Website';

function doPost(e) {
  try {
    const data = (e && e.parameter) || {};

    // Honeypot spam check. Pretend success without creating records.
    if (clean_(data.companyWebsite)) {
      return jsonResponse_({ success: true });
    }

    const input = normalizeWebsiteRequest_(data);
    validateWebsiteRequest_(input);

    const result = createWebsiteServiceRequest_(input);
    sendInternalNotification_(input, result);
    sendCustomerConfirmation_(input, result);

    return jsonResponse_({
      success: true,
      requestNumber: result.requestNumber
    });
  } catch (error) {
    console.error(error);

    return jsonResponse_({
      success: false,
      error: error && error.message ? error.message : String(error)
    });
  }
}

/**
 * Run once from the Apps Script editor after replacing the placeholder ID.
 */
function configureWebsiteServiceRequestIntegration() {
  PropertiesService.getScriptProperties().setProperties({
    SERVICE_SYSTEM_SPREADSHEET_ID: 'PASTE_WORKING_DATABASE_SPREADSHEET_ID_HERE',
    WEBSITE_REQUEST_PHOTO_FOLDER_ID: 'PASTE_APPROVED_REQUEST_PHOTO_FOLDER_ID_HERE'
  });
}

function createWebsiteServiceRequest_(input) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const spreadsheet = getServiceSystemSpreadsheet_();
    const now = new Date();

    const customer = findOrCreateWebsiteCustomer_(spreadsheet, input, now);
    const location = findOrCreateWebsiteLocation_(spreadsheet, input, now);
    const relationship = findOrCreateWebsiteRelationship_(
      spreadsheet,
      customer.customerId,
      location.locationId,
      input.relationshipType,
      now
    );

    const photoFolderUrl = saveRequestPhotos_(input, now);
    const request = createWebsiteRequestRecord_(
      spreadsheet,
      input,
      customer,
      location,
      relationship,
      photoFolderUrl,
      now
    );

    SpreadsheetApp.flush();

    return {
      customerId: customer.customerId,
      locationId: location.locationId,
      relationshipId: relationship.relationshipId,
      requestId: request.requestId,
      requestNumber: request.requestNumber,
      photoFolderUrl: photoFolderUrl
    };
  } finally {
    lock.releaseLock();
  }
}

function findOrCreateWebsiteCustomer_(spreadsheet, input, now) {
  const sheet = getRequiredSheet_(spreadsheet, 'Customers');
  const table = getTable_(sheet);
  const phoneKey = digitsOnly_(input.phone);
  const emailKey = input.email.toLowerCase();

  for (let i = 1; i < table.values.length; i += 1) {
    const row = table.values[i];
    const existingPhone = digitsOnly_(value_(row, table.column, 'PrimaryPhone'));
    const existingEmail = clean_(value_(row, table.column, 'PrimaryEmail')).toLowerCase();

    if (
      (phoneKey && existingPhone === phoneKey) ||
      (emailKey && existingEmail === emailKey)
    ) {
      return {
        customerId: clean_(value_(row, table.column, 'CustomerID')),
        displayName: customerDisplayName_(row, table.column),
        primaryPhone: clean_(value_(row, table.column, 'PrimaryPhone')) || input.phone,
        primaryEmail: clean_(value_(row, table.column, 'PrimaryEmail')) || input.email,
        preferredContact: clean_(value_(row, table.column, 'PreferredContact')) || input.preferredContact,
        wasCreated: false
      };
    }
  }

  const customerId = Utilities.getUuid();
  const row = new Array(table.headers.length).fill('');

  setIfPresent_(row, table.column, 'CustomerID', customerId);
  setIfPresent_(row, table.column, 'CustomerType', 'Individual');
  setIfPresent_(row, table.column, 'FirstName', input.firstName);
  setIfPresent_(row, table.column, 'LastName', input.lastName);
  setIfPresent_(row, table.column, 'PrimaryPhone', input.phone);
  setIfPresent_(row, table.column, 'PrimaryEmail', input.email);
  setIfPresent_(row, table.column, 'PreferredContact', input.preferredContact);
  setIfPresent_(row, table.column, 'BillingAddress1', input.billingAddress1);
  setIfPresent_(row, table.column, 'BillingAddress2', input.billingAddress2);
  setIfPresent_(row, table.column, 'BillingCity', input.billingCity);
  setIfPresent_(row, table.column, 'BillingState', input.billingState);
  setIfPresent_(row, table.column, 'BillingZIP', input.billingZip);
  setIfPresent_(row, table.column, 'CustomerStatus', 'Active');
  setIfPresent_(row, table.column, 'ReferralSource', 'Website');
  setIfPresent_(row, table.column, 'ReferralDetails', 'CornerpostPlumbing.com service request form');
  setIfPresent_(row, table.column, 'DoNotContact', false);
  setIfPresent_(row, table.column, 'ReviewStatus', 'Not Requested');
  setIfPresent_(row, table.column, 'GeneralNotes', 'Created from website service request.');
  setIfPresent_(row, table.column, 'CreatedAt', now);
  setIfPresent_(row, table.column, 'UpdatedAt', now);
  setIfPresent_(row, table.column, 'UpdatedBy', UPDATED_BY);
  sheet.appendRow(row);

  return {
    customerId: customerId,
    displayName: [input.firstName, input.lastName].join(' '),
    primaryPhone: input.phone,
    primaryEmail: input.email,
    preferredContact: input.preferredContact,
    wasCreated: true
  };
}

function findOrCreateWebsiteLocation_(spreadsheet, input, now) {
  const sheet = getRequiredSheet_(spreadsheet, 'ServiceLocations');
  const table = getTable_(sheet);
  const requestedKey = addressKey_(
    input.serviceAddress1,
    input.serviceAddress2,
    input.serviceCity,
    input.serviceState,
    input.serviceZip
  );

  for (let i = 1; i < table.values.length; i += 1) {
    const row = table.values[i];
    const existingKey = addressKey_(
      value_(row, table.column, 'Address1'),
      value_(row, table.column, 'Address2'),
      value_(row, table.column, 'City'),
      value_(row, table.column, 'State'),
      value_(row, table.column, 'ZIP')
    );

    if (existingKey === requestedKey) {
      return {
        locationId: clean_(value_(row, table.column, 'LocationID')),
        locationName: clean_(value_(row, table.column, 'LocationName')),
        wasCreated: false
      };
    }
  }

  const locationId = Utilities.getUuid();
  const row = new Array(table.headers.length).fill('');
  const locationName = [input.serviceAddress1, input.serviceCity]
    .filter(Boolean)
    .join(', ');

  setIfPresent_(row, table.column, 'LocationID', locationId);
  setIfPresent_(row, table.column, 'LocationName', locationName);
  setIfPresent_(row, table.column, 'Address1', input.serviceAddress1);
  setIfPresent_(row, table.column, 'Address2', input.serviceAddress2);
  setIfPresent_(row, table.column, 'City', input.serviceCity);
  setIfPresent_(row, table.column, 'State', input.serviceState);
  setIfPresent_(row, table.column, 'ZIP', input.serviceZip);
  setIfPresent_(row, table.column, 'LocationStatus', 'Active');
  setIfPresent_(row, table.column, 'WaterSource', 'Unknown');
  setIfPresent_(row, table.column, 'SewerType', 'Unknown');
  setIfPresent_(row, table.column, 'CreatedAt', now);
  setIfPresent_(row, table.column, 'UpdatedAt', now);
  setIfPresent_(row, table.column, 'UpdatedBy', UPDATED_BY);
  sheet.appendRow(row);

  return {
    locationId: locationId,
    locationName: locationName,
    wasCreated: true
  };
}

function findOrCreateWebsiteRelationship_(spreadsheet, customerId, locationId, relationshipType, now) {
  const sheet = getRequiredSheet_(spreadsheet, 'CustomerLocationRelationships');
  const table = getTable_(sheet);

  for (let i = 1; i < table.values.length; i += 1) {
    const row = table.values[i];
    const status = clean_(value_(row, table.column, 'RelationshipStatus'));

    if (
      clean_(value_(row, table.column, 'CustomerID')) === customerId &&
      clean_(value_(row, table.column, 'LocationID')) === locationId &&
      (!status || status === 'Active')
    ) {
      return {
        relationshipId: clean_(value_(row, table.column, 'RelationshipID')),
        relationshipType: clean_(value_(row, table.column, 'RelationshipType')) || relationshipType,
        wasCreated: false
      };
    }
  }

  const relationshipId = Utilities.getUuid();
  const row = new Array(table.headers.length).fill('');
  const isOwner = relationshipType === 'Owner';

  setIfPresent_(row, table.column, 'RelationshipID', relationshipId);
  setIfPresent_(row, table.column, 'CustomerID', customerId);
  setIfPresent_(row, table.column, 'LocationID', locationId);
  setIfPresent_(row, table.column, 'RelationshipType', relationshipType);
  setIfPresent_(row, table.column, 'IsPrimaryContact', true);
  setIfPresent_(row, table.column, 'BillingResponsibility', isOwner ? 'Responsible' : 'Unknown');
  setIfPresent_(row, table.column, 'StartDate', new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  setIfPresent_(row, table.column, 'RelationshipStatus', 'Active');
  setIfPresent_(row, table.column, 'Notes', 'Created from website service request.');
  setIfPresent_(row, table.column, 'CreatedAt', now);
  setIfPresent_(row, table.column, 'UpdatedAt', now);
  setIfPresent_(row, table.column, 'UpdatedBy', UPDATED_BY);
  sheet.appendRow(row);

  return {
    relationshipId: relationshipId,
    relationshipType: relationshipType,
    wasCreated: true
  };
}

function createWebsiteRequestRecord_(spreadsheet, input, customer, location, relationship, photoFolderUrl, now) {
  const sheet = getRequiredSheet_(spreadsheet, 'ServiceRequests');
  const table = getTable_(sheet);
  const requestId = Utilities.getUuid();
  const requestNumber = nextRequestNumber_(sheet, table.column, now);
  const row = new Array(table.headers.length).fill('');
  const ownerApprovalRequired = input.relationshipType === 'Tenant';

  setIfPresent_(row, table.column, 'RequestID', requestId);
  setIfPresent_(row, table.column, 'RequestNumber', requestNumber);
  setIfPresent_(row, table.column, 'SubmittedAt', now);
  setIfPresent_(row, table.column, 'RequestSource', 'Website');
  setIfPresent_(row, table.column, 'CustomerMatchStatus', 'Matched');
  setIfPresent_(row, table.column, 'LocationMatchStatus', 'Matched');
  setIfPresent_(row, table.column, 'CustomerID', customer.customerId);
  setIfPresent_(row, table.column, 'LocationID', location.locationId);
  setIfPresent_(row, table.column, 'SubmittedName', customer.displayName);
  setIfPresent_(row, table.column, 'SubmittedPhone', input.phone);
  setIfPresent_(row, table.column, 'SubmittedEmail', input.email);
  setIfPresent_(row, table.column, 'PreferredContact', input.preferredContact);
  setIfPresent_(row, table.column, 'SubmittedAddress1', input.serviceAddress1);
  setIfPresent_(row, table.column, 'SubmittedAddress2', input.serviceAddress2);
  setIfPresent_(row, table.column, 'SubmittedCity', input.serviceCity);
  setIfPresent_(row, table.column, 'SubmittedState', input.serviceState);
  setIfPresent_(row, table.column, 'SubmittedZIP', input.serviceZip);
  setIfPresent_(row, table.column, 'RequestedByName', customer.displayName);
  setIfPresent_(row, table.column, 'RequestedByRelationship', relationship.relationshipType);
  setIfPresent_(row, table.column, 'OwnerApprovalRequired', ownerApprovalRequired);
  setIfPresent_(row, table.column, 'OwnerApprovalStatus', ownerApprovalRequired ? 'Pending' : 'Not Required');
  setIfPresent_(row, table.column, 'ApprovalOverride', false);
  setIfPresent_(row, table.column, 'RequestCategory', input.service);
  setIfPresent_(row, table.column, 'RequestDescription', input.message);
  setIfPresent_(row, table.column, 'PreferredTimeWindow', input.preferredTime);
  setIfPresent_(row, table.column, 'Urgency', 'Routine');
  setIfPresent_(row, table.column, 'PhotosURL', photoFolderUrl);
  setIfPresent_(row, table.column, 'InternalNotes', 'Submitted through CornerpostPlumbing.com.');
  setIfPresent_(row, table.column, 'RequestStatus', 'New');
  setIfPresent_(row, table.column, 'UpdatedAt', now);
  setIfPresent_(row, table.column, 'UpdatedBy', UPDATED_BY);
  sheet.appendRow(row);

  return { requestId: requestId, requestNumber: requestNumber };
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

function nextRequestNumber_(sheet, column, now) {
  if (column.RequestNumber === undefined) {
    throw new Error('ServiceRequests is missing RequestNumber.');
  }

  const timezone = Session.getScriptTimeZone() || 'America/Denver';
  const prefix = 'SR-' + Utilities.formatDate(now, timezone, 'yyyyMMdd') + '-';
  const lastRow = sheet.getLastRow();
  let highest = 0;

  if (lastRow >= 2) {
    const values = sheet
      .getRange(2, column.RequestNumber + 1, lastRow - 1, 1)
      .getDisplayValues()
      .flat();

    values.forEach(function (value) {
      const text = clean_(value);
      if (text.indexOf(prefix) !== 0) return;
      const sequence = Number(text.substring(prefix.length));
      if (Number.isInteger(sequence) && sequence > highest) highest = sequence;
    });
  }

  return prefix + String(highest + 1).padStart(3, '0');
}

function getServiceSystemSpreadsheet_() {
  const id = clean_(PropertiesService.getScriptProperties().getProperty(DATABASE_ID_PROPERTY));

  if (!id || id.indexOf('PASTE_') === 0) {
    throw new Error('Service System database integration has not been configured.');
  }

  return SpreadsheetApp.openById(id);
}

function getRequiredSheet_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error('Required database table not found: ' + name);
  return sheet;
}

function getTable_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) throw new Error(sheet.getName() + ' has no header row.');

  const headers = values[0].map(clean_);
  const column = {};
  headers.forEach(function (header, index) {
    if (header) column[header] = index;
  });

  return { headers: headers, column: column, values: values };
}

function setIfPresent_(row, column, name, value) {
  if (column[name] !== undefined) row[column[name]] = value;
}

function value_(row, column, name) {
  return column[name] === undefined ? '' : row[column[name]];
}

function customerDisplayName_(row, column) {
  const company = clean_(value_(row, column, 'CompanyName'));
  const first = clean_(value_(row, column, 'FirstName'));
  const last = clean_(value_(row, column, 'LastName'));
  return company || [first, last].filter(Boolean).join(' ') || 'Website Customer';
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

function addressKey_(address1, address2, city, state, zip) {
  return [address1, address2, city, state, zip]
    .map(function (value) {
      return clean_(value)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
    })
    .join('|');
}

function digitsOnly_(value) {
  return clean_(value).replace(/\D/g, '');
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
