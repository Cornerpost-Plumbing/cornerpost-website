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

window.CornerpostReviewFeedStatus = { state: "starting", elapsedMs: 0 };
const cornerpostReviewDebug = new URLSearchParams(window.location.search).get("reviewdebug") === "1";
const cornerpostReviewStarted = Date.now();

function cornerpostSetReviewStatus(state, detail = "") {
  window.CornerpostReviewFeedStatus = {
    state,
    detail,
    elapsedMs: Date.now() - cornerpostReviewStarted,
    reviews: Array.isArray(window.CornerpostReviews) ? window.CornerpostReviews.length : 0
  };
  if (!cornerpostReviewDebug) return;
  const show = () => {
    let panel = document.getElementById("cornerpost-review-debug");
    if (!panel) {
      panel = document.createElement("aside");
      panel.id = "cornerpost-review-debug";
      panel.setAttribute("role", "status");
      panel.style.cssText = "position:fixed;bottom:12px;left:12px;right:12px;z-index:2147483647;padding:12px;background:#fff;color:#172018;border:2px solid #2c312b;border-radius:6px;font:13px/1.5 monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:40vh;overflow:auto";
      document.body.appendChild(panel);
    }
    panel.textContent = "Cornerpost review diagnostic\n" + JSON.stringify(window.CornerpostReviewFeedStatus, null, 2);
  };
  if (document.body) show();
  else document.addEventListener("DOMContentLoaded", show, { once: true });
}

window.CornerpostReviewsReady = new Promise((resolve) => {
  const fallback = Array.isArray(window.CornerpostReviews)
    ? window.CornerpostReviews.slice()
    : [];
  const feedUrl = window.Cornerpost?.reviews?.feedUrl || "";

  if (!feedUrl || feedUrl.includes("PASTE_GOOGLE_REVIEW_FEED_WEB_APP_URL_HERE")) {
    cornerpostSetReviewStatus("missing-configuration", "Feed URL is missing or placeholder");
    resolve(fallback);
    return;
  }

  const callbackName = `CornerpostGoogleReviews_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;

  let settled = false;
  let script = null;

  const finish = (reviews, state, detail = "") => {
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

    cornerpostSetReviewStatus(state, detail);
    resolve(window.CornerpostReviews);
  };

  window[callbackName] = (payload) => {
    if (payload && payload.success === true && Array.isArray(payload.reviews)) {
      finish(payload.reviews, "success", "JSONP callback received");
      return;
    }

    console.warn("Cornerpost review feed returned no usable reviews.", payload || "");
    finish(fallback, "invalid-response", "Callback did not contain a successful reviews array");
  };

  script = document.createElement("script");
  script.async = true;
  script.src = `${feedUrl}${feedUrl.includes("?") ? "&" : "?"}` +
    `action=reviews&callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;

  script.onerror = () => {
    console.warn("Cornerpost review feed could not be loaded.");
    finish(fallback, "script-error", "Browser reported script load error");
  };

  cornerpostSetReviewStatus("loading", "JSONP request started");
  document.head.appendChild(script);

  window.setTimeout(() => {
    if (!settled) {
      console.warn("Cornerpost review feed timed out.");
      finish(fallback, "timeout", "No callback within 10 seconds");
    }
  }, 10000);
});
