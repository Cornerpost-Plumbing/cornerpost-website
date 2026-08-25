window.CornerpostReviews = [
  /*
  Manual fallback only. Google Business Profile is the normal source.

  Example:
  {
    author: "Customer Name",
    rating: 5,
    date: "2026-08-20T18:42:00Z",
    text: "Review text",
    source: "Google"
  }
  */
];

window.CornerpostReviewsReady = new Promise((resolve) => {
  const fallback = Array.isArray(window.CornerpostReviews)
    ? window.CornerpostReviews.slice()
    : [];
  const feedUrl = window.Cornerpost?.reviews?.feedUrl || "";

  if (!feedUrl || feedUrl.includes("PASTE_GOOGLE_REVIEW_FEED_WEB_APP_URL_HERE")) {
    resolve(fallback);
    return;
  }

  const callbackName = `CornerpostGoogleReviews_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;

  let settled = false;
  let script = null;

  const finish = (reviews) => {
    if (settled) return;
    settled = true;

    window.CornerpostReviews = Array.isArray(reviews) ? reviews : fallback;

    if (script && script.parentNode) {
      script.parentNode.removeChild(script);
    }

    try {
      delete window[callbackName];
    } catch (error) {
      window[callbackName] = undefined;
    }

    resolve(window.CornerpostReviews);
  };

  window[callbackName] = (payload) => {
    if (payload && payload.success === true && Array.isArray(payload.reviews)) {
      finish(payload.reviews);
      return;
    }

    console.warn("Cornerpost review feed returned no usable reviews.", payload || "");
    finish(fallback);
  };

  script = document.createElement("script");
  script.async = true;
  script.src = `${feedUrl}${feedUrl.includes("?") ? "&" : "?"}` +
    `action=reviews&callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;

  script.onerror = () => {
    console.warn("Cornerpost review feed could not be loaded.");
    finish(fallback);
  };

  document.head.appendChild(script);

  window.setTimeout(() => {
    if (!settled) {
      console.warn("Cornerpost review feed timed out.");
      finish(fallback);
    }
  }, 10000);
});
