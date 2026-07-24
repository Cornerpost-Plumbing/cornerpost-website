const SERVICE_EMAIL = "Service@CornerpostPlumbing.com";

function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const data = e.parameter;

    // Honeypot spam check. If this hidden field is filled, pretend success and do nothing.
    if (data.companyWebsite && data.companyWebsite.trim() !== "") {
      return jsonResponse({ success: true });
    }

    const timestamp = new Date();

    const name = clean(data.name);
    const phone = clean(data.phone);
    const email = clean(data.email);
    const streetAddress = clean(data.streetAddress);
    const city = clean(data.city);
    const state = clean(data.state);
    const service = clean(data.service);
    const message = clean(data.message);

    sheet.appendRow([
      timestamp,
      name,
      phone,
      email,
      streetAddress,
      city,
      state,
      service,
      message,
      "New"
    ]);

    const subject = `New Service Request - ${name || "Website Form"}`;

    const body =
`New Service Request

Date:
${timestamp}

Name:
${name}

Phone:
${phone}

Email:
${email || "Not provided"}

Service Address:
${streetAddress}
${city}, ${state}

Requested Service:
${service}

Project Details:
${message}
`;

    MailApp.sendEmail({
      to: SERVICE_EMAIL,
      subject,
      body,
      replyTo: email || undefined
    });

    return jsonResponse({ success: true });
  } catch (error) {
    return jsonResponse({ success: false, error: error.toString() });
  }
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
