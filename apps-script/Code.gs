/**
 * Cornerpost Plumbing public Google review feed.
 *
 * This project is intentionally separate from the website service-request
 * intake. It has one job: read Cornerpost Plumbing's own Google Business
 * Profile reviews and expose a small read-only JSONP feed to the website.
 *
 * The web app must be deployed as USER_DEPLOYING and may be accessed by
 * anyone. The Business Profile calls still run as the deploying owner.
 */

const REVIEW_FEED_BUILD = '2026-08-23.1';
const REVIEW_FEED_BUSINESS_TITLE = 'Cornerpost Plumbing';
const REVIEW_CACHE_SECONDS = 600;
const REVIEW_CACHE_KEY = 'CORNERPOST_PUBLIC_GOOGLE_REVIEWS_V1';
const REVIEW_ACCOUNT_PROPERTY = 'GBP_ACCOUNT_NAME';
const REVIEW_LOCATION_PROPERTY = 'GBP_LOCATION_NAME';

function doGet(e) {
  const params = (e && e.parameter) || {};

  if (String(params.action || '').toLowerCase() !== 'reviews') {
    return jsonResponse_({
      success: true,
      service: 'Cornerpost Google Review Feed',
      build: REVIEW_FEED_BUILD
    });
  }

  try {
    const payload = getPublicGoogleReviews_();
    return callbackOrJsonResponse_(payload, params.callback);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return callbackOrJsonResponse_({
      success: false,
      reviews: [],
      error: 'Review feed unavailable.'
    }, params.callback);
  }
}

/**
 * Run this once from the Apps Script editor after the required Google
 * Business Profile APIs are enabled. It forces authorization, verifies that
 * Cornerpost Plumbing can be found in the deploying account, and logs the
 * current review count.
 */
function testGoogleReviewFeed() {
  clearGoogleReviewFeedCache();
  const location = resolveCornerpostLocation_();
  const payload = getPublicGoogleReviews_(true);

  console.log(JSON.stringify({
    account: location.accountName,
    location: location.locationName,
    title: location.title,
    reviewsReturned: payload.reviews.length,
    totalReviewCount: payload.totalReviewCount
  }, null, 2));

  return payload;
}

function clearGoogleReviewFeedCache() {
  CacheService.getScriptCache().remove(REVIEW_CACHE_KEY);
}

function forgetGoogleBusinessProfileLocation() {
  const properties = PropertiesService.getScriptProperties();
  properties.deleteProperty(REVIEW_ACCOUNT_PROPERTY);
  properties.deleteProperty(REVIEW_LOCATION_PROPERTY);
  clearGoogleReviewFeedCache();
}

function getPublicGoogleReviews_(skipCache) {
  const cache = CacheService.getScriptCache();

  if (!skipCache) {
    const cached = cache.get(REVIEW_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  const location = resolveCornerpostLocation_();
  const accountId = resourceId_(location.accountName, 'accounts');
  const locationId = resourceId_(location.locationName, 'locations');

  const url =
    'https://mybusiness.googleapis.com/v4/accounts/' +
    encodeURIComponent(accountId) +
    '/locations/' +
    encodeURIComponent(locationId) +
    '/reviews?pageSize=50&orderBy=' +
    encodeURIComponent('updateTime desc');

  const response = googleBusinessProfileGet_(url);
  const reviews = Array.isArray(response.reviews) ? response.reviews : [];

  const payload = {
    success: true,
    source: 'Google',
    averageRating: Number(response.averageRating || 0),
    totalReviewCount: Number(response.totalReviewCount || reviews.length),
    reviews: reviews.map(normalizeReview_),
    fetchedAt: new Date().toISOString()
  };

  // Google Business Profile policy permits temporary performance caching.
  // Ten minutes keeps traffic off the API while remaining far inside the
  // 30-day maximum storage window.
  cache.put(REVIEW_CACHE_KEY, JSON.stringify(payload), REVIEW_CACHE_SECONDS);

  return payload;
}

function resolveCornerpostLocation_() {
  const properties = PropertiesService.getScriptProperties();
  const savedAccount = properties.getProperty(REVIEW_ACCOUNT_PROPERTY);
  const savedLocation = properties.getProperty(REVIEW_LOCATION_PROPERTY);

  if (savedAccount && savedLocation) {
    return {
      accountName: savedAccount,
      locationName: savedLocation,
      title: REVIEW_FEED_BUSINESS_TITLE
    };
  }

  const accountsResponse = googleBusinessProfileGet_(
    'https://mybusinessaccountmanagement.googleapis.com/v1/accounts'
  );
  const accounts = Array.isArray(accountsResponse.accounts)
    ? accountsResponse.accounts
    : [];

  for (const account of accounts) {
    if (!account || !account.name) continue;

    const locationsUrl =
      'https://mybusinessbusinessinformation.googleapis.com/v1/' +
      account.name +
      '/locations?readMask=name,title';

    const locationsResponse = googleBusinessProfileGet_(locationsUrl);
    const locations = Array.isArray(locationsResponse.locations)
      ? locationsResponse.locations
      : [];

    const match = locations.find((location) =>
      normalize_(location && location.title) === normalize_(REVIEW_FEED_BUSINESS_TITLE)
    );

    if (match && match.name) {
      properties.setProperty(REVIEW_ACCOUNT_PROPERTY, account.name);
      properties.setProperty(REVIEW_LOCATION_PROPERTY, match.name);

      return {
        accountName: account.name,
        locationName: match.name,
        title: match.title || REVIEW_FEED_BUSINESS_TITLE
      };
    }
  }

  throw new Error(
    'Cornerpost Plumbing was not found in the Google Business Profile accounts available to this Apps Script user.'
  );
}

function normalizeReview_(review) {
  const reviewer = (review && review.reviewer) || {};

  return {
    author: reviewer.displayName || 'Google Customer',
    rating: starRatingNumber_(review && review.starRating),
    date: String((review && (review.createTime || review.updateTime)) || ''),
    text: String((review && review.comment) || ''),
    source: 'Google'
  };
}

function starRatingNumber_(value) {
  const ratings = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5
  };
  return ratings[String(value || '').toUpperCase()] || 0;
}

function googleBusinessProfileGet_(url) {
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const text = response.getContentText();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error('Google Business Profile returned an unreadable response (' + status + ').');
  }

  if (status < 200 || status >= 300) {
    const apiMessage =
      data && data.error && data.error.message
        ? data.error.message
        : 'HTTP ' + status;
    throw new Error('Google Business Profile API error: ' + apiMessage);
  }

  return data;
}

function resourceId_(resourceName, expectedCollection) {
  const match = String(resourceName || '').match(
    new RegExp('^' + expectedCollection + '/([^/]+)$')
  );
  if (!match) {
    throw new Error('Unexpected Google Business Profile resource name: ' + resourceName);
  }
  return match[1];
}

function normalize_(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function callbackOrJsonResponse_(data, callback) {
  const callbackName = String(callback || '').trim();

  if (callbackName && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callbackName)) {
    return ContentService
      .createTextOutput(callbackName + '(' + JSON.stringify(data) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return jsonResponse_(data);
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
