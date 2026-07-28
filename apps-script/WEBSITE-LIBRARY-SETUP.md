# Website Apps Script Library Setup

Add the Service System project as an Apps Script library with identifier `CornerpostService`.

Add these Script Properties to the Cornerpost Website Apps Script project:

- `SERVICE_SYSTEM_SPREADSHEET_ID`: ID from the Cornerpost Database spreadsheet URL.
- `WEBSITE_REQUEST_PHOTO_FOLDER_ID`: ID from the approved website-request photo folder URL.

After adding the library and properties, run `testServiceSystemLibraryConnection()` from the Website Apps Script editor. Authorize the script when prompted. The function should return `{ success: true, spreadsheetName: ... }` and does not write records.
