# Cornerpost Website Intake Rebuild

This is a clean standalone Apps Script endpoint for the public website service-request form.

It does not use the Cornerpost Service System library and does not depend on any previous website form Apps Script project.

## Project name

Create a new standalone Apps Script project named:

`Cornerpost Website Intake`

## Files

Copy or push these files into the new project:

- `apps-script/Code.gs`
- `apps-script/appsscript.json`

## Script Properties

Add these properties to the new project:

- `SERVICE_SYSTEM_SPREADSHEET_ID`
- `WEBSITE_REQUEST_PHOTO_FOLDER_ID`

## Deployment

Deploy as a Web app:

- Execute as: Me
- Who has access: Anyone

Copy the new `/exec` URL. Update `forms.scriptURL` in the website `js/config.js` to that URL.

## Verification

Submit one test request and verify a new `doPost` execution plus records in:

- Customers
- ServiceLocations
- CustomerLocationRelationships
- ServiceRequests
