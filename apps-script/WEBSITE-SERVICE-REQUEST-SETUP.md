# Website Service Request Integration Setup

The website intake Apps Script remains separate from the private Cornerpost Service System web app. It writes approved records directly to the Working database.

## Records created or matched

Each valid website submission will:

1. Match an existing customer by exact phone or email, or create a new customer.
2. Match an existing service location by normalized address, or create a new location.
3. Match or create an active CustomerLocationRelationships record using Owner or Tenant.
4. Create a ServiceRequests record with RequestSource set to Website.
5. Mark owner approval Pending for tenant requests and Not Required for owner requests.
6. Store uploaded request photos in the approved Drive folder and write the folder URL to ServiceRequests.PhotosURL.
7. Email Cornerpost Plumbing and send the customer a confirmation containing the service request number when an email address was supplied.

## One-time configuration

1. Open the Apps Script project used by the public website form.
2. Replace `Code.gs` with the updated file.
3. Open **Project Settings > Script Properties**.
4. Add `SERVICE_SYSTEM_SPREADSHEET_ID` with the spreadsheet ID of the live Working Cornerpost Database.
5. Add `WEBSITE_REQUEST_PHOTO_FOLDER_ID` with the Drive folder ID approved for website service-request photos.
6. Deploy a new web-app version using **Execute as: Me** and the same public access setting already used by the website form.
7. Copy the new deployment URL into `js/config.js` under `forms.scriptURL` if the deployment URL changed.
8. Submit a controlled test request and confirm records appear in Customers, ServiceLocations, CustomerLocationRelationships, and ServiceRequests.

Do not place the database spreadsheet ID directly in public website JavaScript or HTML.
