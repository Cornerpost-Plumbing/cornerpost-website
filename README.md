# Cornerpost Website v1.0

## Folder structure

- index.html
- css/style.css
- js/main.js
- images/
- apps-script/Code.gs
- robots.txt
- sitemap.xml

## Required image filenames

Place these files in the images folder:

- cornerpost-logo.svg
- hero-truck-western-nebraska.jpg
- work-truck-logo.jpg
- work-sewer-line.jpg
- work-mechanical-room.jpg
- work-remodel-plumbing.jpg
- owner-cornerpost-field.jpg

## Google Sheet headers

Use this header row:

Date | Name | Phone | Email | Street Address | City | State | Service | Message | Status

## Apps Script setup

1. Open the Google Sheet.
2. Go to Extensions > Apps Script.
3. Paste the contents of apps-script/Code.gs.
4. Deploy as a Web App.
5. Execute as: Me.
6. Who has access: Anyone.
7. Authorize the app.
8. Copy the Web App URL.
9. Paste the URL into index.html in the form's data-script-url attribute.
10. After every Apps Script code change, deploy a new version.

## Form test checklist

- Open the site.
- Enter a test request.
- Confirm phone number formats as (308) 225-3392.
- Submit the form.
- Confirm success message appears.
- Confirm email arrives at Service@CornerpostPlumbing.com.
- Confirm a row appears in the Google Sheet.

## Notes

The homepage is the current stable v1.0. Future pages should reuse the same header, footer, typography, spacing, and design system.
