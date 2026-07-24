document.addEventListener("DOMContentLoaded", () => {
  renderSiteChrome();
  renderServiceContent();
  renderReviewContent();
  applySiteConfig();
  initMobileNavigation();
  initAnchorScrollOffset();
  initServiceRequestForm();
});

function getConfig() {
  return window.Cornerpost || (typeof Cornerpost !== "undefined" ? Cornerpost : null);
}

function getNavigation() {
  return Array.isArray(window.CornerpostNavigation) ? window.CornerpostNavigation : [];
}

function getServices() {
  return Array.isArray(window.CornerpostServices) ? window.CornerpostServices : [];
}

function getReviews() {
  return Array.isArray(window.CornerpostReviews) ? window.CornerpostReviews : [];
}

function getCurrentPage() {
  return document.body.dataset.page || "home";
}

function renderSiteChrome() {
  renderSiteHeader();
  renderSiteFooter();
}

function renderSiteHeader() {
  const header = document.getElementById("site-header");
  if (!header) return;

  const currentPage = getCurrentPage();

  header.innerHTML = `
    <div class="container header-inner">
      <a class="brand" href="${currentPage === "home" ? "#top" : "index.html#top"}" aria-label="Home" data-brand-home>
        <img src="" alt="" class="brand-logo" data-brand-logo />
      </a>

      <button
        class="menu-toggle"
        type="button"
        aria-controls="main-navigation"
        aria-expanded="false"
        aria-label="Open menu"
      >
        <span class="menu-toggle-bars" aria-hidden="true"></span>
        <span>Menu</span>
      </button>

      <nav class="site-nav" id="main-navigation" aria-label="Main navigation">
        ${buildNavigationHtml()}
      </nav>
    </div>
  `;
}

function renderSiteFooter() {
  const footer = document.getElementById("site-footer");
  if (!footer) return;

  footer.innerHTML = `
    <div class="container footer-inner">
      <p>&copy; <span data-copyright-year></span> <span data-business-name></span>. All rights reserved.</p>
      <p data-footer-credential-line></p>
    </div>
  `;
}

function buildNavigationHtml() {
  const navigation = getNavigation();
  if (!navigation.length) return "";

  return navigation.map((item) => buildNavigationItemHtml(item)).join("");
}

function buildNavigationItemHtml(item) {
  const currentPage = getCurrentPage();
  const href = resolveNavigationHref(item.href, currentPage);
  const linkClass = item.button ? "nav-button" : `nav-link${isActiveNavigationItem(item) ? " is-active" : ""}`;

  if (item.children === "services") {
    const services = getServices();
    const dropdown = services
      .map((service) => `<a href="services.html#${escapeAttribute(service.id)}">${escapeHtml(service.title)}</a>`)
      .join("");

    return `
      <div class="nav-item has-dropdown">
        <a href="${escapeAttribute(href)}" class="${linkClass}">${escapeHtml(item.title)}</a>
        <div class="dropdown-menu" aria-label="${escapeAttribute(item.title)} submenu">${dropdown}</div>
      </div>
    `;
  }

  return `<a href="${escapeAttribute(href)}" class="${linkClass}">${escapeHtml(item.title)}</a>`;
}

function resolveNavigationHref(href, currentPage) {
  if (typeof href === "string") return href;
  if (href && typeof href === "object") {
    return href[currentPage] || href.default || "#";
  }
  return "#";
}

function isActiveNavigationItem(item) {
  const currentPage = getCurrentPage();
  return Boolean(item.page && item.page === currentPage);
}

function applySiteConfig() {
  const config = getConfig();
  if (!config) return;

  const business = config.business || {};
  const phone = business.phone || {};
  const serviceArea = business.serviceArea || {};
  const availability = business.availability || {};
  const hours = business.hours || {};
  const credentials = business.credentials || {};
  const branding = config.branding || {};
  const seo = config.seo || {};

  const pageName = document.body.dataset.page;
  if (pageName === "services" && seo.servicesTitle) {
    document.title = seo.servicesTitle;
  } else if (pageName === "contact" && seo.contactTitle) {
    document.title = seo.contactTitle;
  } else if (pageName === "about" && seo.aboutTitle) {
    document.title = seo.aboutTitle;
  } else if (pageName === "reviews" && seo.reviewsTitle) {
    document.title = seo.reviewsTitle;
  } else if (seo.homeTitle) {
    document.title = seo.homeTitle;
  }

  const description = document.querySelector("meta[name='description']");
  if (description && seo.description) {
    description.setAttribute("content", seo.description);
  }

  setText("[data-business-name]", business.name);
  setText("[data-business-slogan]", business.slogan);
  setText("[data-business-slogan-line-one]", business.sloganLines?.[0]);
  setText("[data-business-slogan-line-two]", business.sloganLines?.[1]);
  setText("[data-phone-display]", phone.display);
  setText("[data-phone-cta]", phone.display ? `Call ${phone.display}` : "Call");
  setText("[data-email-display]", business.email);
  setText("[data-website-display]", business.website);
  setText("[data-service-radius]", serviceArea.radius);
  setText("[data-service-region]", serviceArea.region);
  setText("[data-service-city]", serviceArea.city);
  setText("[data-service-state]", serviceArea.state);
  setText("[data-service-state-name]", serviceArea.stateName);
  setText("[data-service-area-summary]", buildServiceAreaSummary(serviceArea));
  setText("[data-emergency-title]", availability.emergency);
  setText("[data-emergency-description]", availability.emergencyDescription);
  setText("[data-urgent-instruction]", availability.urgentInstruction);
  setText("[data-hours-service-calls]", hours.serviceCalls);
  setText("[data-hours-office]", hours.office);
  setText("[data-hours-emergency]", hours.emergency);
  setText("[data-credential-primary]", credentials.primary);
  setText("[data-credential-primary-description]", credentials.primaryDescription);
  setText("[data-credential-secondary]", credentials.secondary);
  setText("[data-credential-secondary-description]", credentials.secondaryDescription);
  setText("[data-footer-credential-line]", business.footerCredentialLine);
  setText("[data-copyright-year]", business.copyrightYear || String(new Date().getFullYear()));

  document.querySelectorAll("[data-phone-link]").forEach((element) => {
    if (phone.digits) element.setAttribute("href", `tel:${phone.digits}`);
    if (!element.textContent.trim()) element.textContent = phone.display || "Call";
  });

  document.querySelectorAll("[data-email-link]").forEach((element) => {
    if (business.email) element.setAttribute("href", `mailto:${business.email}`);
    if (!element.textContent.trim()) element.textContent = business.email || "Email";
  });

  document.querySelectorAll("[data-website-link]").forEach((element) => {
    if (business.website) element.setAttribute("href", business.website);
    if (!element.textContent.trim()) element.textContent = business.website || "Website";
  });

  const reviewsConfig = config.reviews || {};
  setText("[data-reviews-home-heading]", reviewsConfig.homeHeading);
  setText("[data-reviews-home-intro]", reviewsConfig.homeIntro);
  setText("[data-reviews-page-intro]", reviewsConfig.pageIntro);
  setText("[data-reviews-feedback-message]", reviewsConfig.feedbackMessage);

  document.querySelectorAll("[data-leave-review-link]").forEach((element) => {
    if (reviewsConfig.leaveReviewUrl) {
      element.setAttribute("href", reviewsConfig.leaveReviewUrl);
      element.removeAttribute("aria-disabled");
      element.classList.remove("is-disabled");
    } else {
      element.setAttribute("href", "#");
      element.setAttribute("aria-disabled", "true");
      element.classList.add("is-disabled");
      element.addEventListener("click", (event) => event.preventDefault());
    }
  });

  document.querySelectorAll("[data-reviews-profile-link]").forEach((element) => {
    if (reviewsConfig.profileUrl) {
      element.setAttribute("href", reviewsConfig.profileUrl);
    } else {
      element.hidden = true;
    }
  });

  document.querySelectorAll("[data-brand-logo]").forEach((image) => {
    if (branding.logo) image.setAttribute("src", branding.logo);
    if (business.name) image.setAttribute("alt", `${business.name} logo`);
  });

  document.querySelectorAll("[data-brand-home]").forEach((element) => {
    if (business.name) element.setAttribute("aria-label", `${business.name} home`);
  });

  document.querySelectorAll("[data-hero-image]").forEach((image) => {
    if (branding.heroImage) image.setAttribute("src", branding.heroImage);
  });
}

function setText(selector, value) {
  if (value === undefined || value === null || value === "") return;
  document.querySelectorAll(selector).forEach((element) => {
    element.textContent = value;
  });
}

function buildServiceAreaSummary(serviceArea) {
  if (!serviceArea) return "";

  const radius = serviceArea.radius || "";
  const city = serviceArea.city || "";
  const state = serviceArea.stateName || serviceArea.state || "";

  if (radius && city && state) {
    return `Serving homeowners within ${radius} miles of ${city}, ${state}.`;
  }

  return [radius ? `${radius} miles` : "", city, state].filter(Boolean).join(" ");
}



function renderReviewContent() {
  const reviews = getReviews()
    .slice()
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  renderHomeReviews(reviews);
  renderReviewsPage(reviews);
  initReviewsCarousel();
}

function renderHomeReviews(reviews) {
  const config = getConfig();
  const reviewsConfig = config?.reviews || {};

  document.querySelectorAll("[data-reviews-home]").forEach((container) => {
    if (!reviews.length) {
      container.innerHTML = buildReviewsEmptyState(reviewsConfig, "home");
      container.classList.add("is-empty");
      return;
    }

    container.classList.remove("is-empty");
    container.innerHTML = reviews.slice(0, 4).map((review) => buildReviewCard(review)).join("");
  });
}

function renderReviewsPage(reviews) {
  const config = getConfig();
  const reviewsConfig = config?.reviews || {};

  document.querySelectorAll("[data-reviews-page]").forEach((container) => {
    if (!reviews.length) {
      container.innerHTML = buildReviewsEmptyState(reviewsConfig, "page");
      return;
    }

    container.innerHTML = reviews.map((review) => buildReviewCard(review, true)).join("");
  });
}

function buildReviewsEmptyState(reviewsConfig, context) {
  const title = reviewsConfig.emptyTitle || "No reviews yet";
  const message = reviewsConfig.emptyMessage || "Customer reviews will appear here as they are received.";
  const className = context === "home" ? "reviews-empty-state reviews-empty-state-home" : "reviews-empty-state";

  return `
    <article class="${className}">
      <div class="reviews-empty-mark" aria-hidden="true">★</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
    </article>
  `;
}

function buildReviewCard(review, fullWidth = false) {
  const rating = Math.max(0, Math.min(5, Number(review.rating) || 0));
  const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
  const dateText = formatReviewDate(review.date);
  const source = review.source || getConfig()?.reviews?.sourceName || "Google";
  const cardClass = fullWidth ? "review-card review-card-full" : "review-card";

  return `
    <article class="${cardClass}">
      <div class="review-card-topline">
        <p class="review-stars" aria-label="${rating} out of 5 stars">${stars}</p>
        ${dateText ? `<time datetime="${escapeAttribute(review.date || "")}">${escapeHtml(dateText)}</time>` : ""}
      </div>
      <blockquote>${escapeHtml(review.text || "")}</blockquote>
      <footer>
        <strong>${escapeHtml(review.author || "Customer")}</strong>
        <span>${escapeHtml(source)}</span>
      </footer>
    </article>
  `;
}

function formatReviewDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

function initReviewsCarousel() {
  document.querySelectorAll("[data-reviews-carousel]").forEach((carousel) => {
    const viewport = carousel.querySelector("[data-reviews-viewport]");
    const track = carousel.querySelector("[data-reviews-home]");
    const previous = carousel.querySelector("[data-reviews-previous]");
    const next = carousel.querySelector("[data-reviews-next]");
    const cards = track ? Array.from(track.querySelectorAll(".review-card")) : [];

    if (!viewport || !track || cards.length === 0) {
      if (previous) previous.hidden = true;
      if (next) next.hidden = true;
      carousel.classList.add("is-empty");
      return;
    }

    carousel.classList.remove("is-empty");

    let autoAdvance = null;
    let isPaused = false;

    const isDesktop = () => window.matchMedia("(min-width: 961px)").matches;
    const isTablet = () => window.matchMedia("(min-width: 641px) and (max-width: 960px)").matches;

    const getVisibleCount = () => {
      if (isDesktop()) return 3;
      if (isTablet()) return 2;
      return 1;
    };

    const getStep = () => {
      const firstCard = cards[0];
      if (!firstCard) return viewport.clientWidth;
      const styles = window.getComputedStyle(track);
      const gap = parseFloat(styles.columnGap || styles.gap || 0);
      const cardsPerAdvance = isTablet() ? 2 : 1;
      return (firstCard.getBoundingClientRect().width + gap) * cardsPerAdvance;
    };

    const updateControls = () => {
      const shouldShowControls = !isDesktop() && cards.length > getVisibleCount();
      if (previous) previous.hidden = !shouldShowControls;
      if (next) next.hidden = !shouldShowControls;
    };

    const scrollReviews = (direction) => {
      if (isDesktop()) return;

      viewport.scrollBy({
        left: direction * getStep(),
        behavior: "smooth"
      });
    };

    const stopAutoAdvance = () => {
      if (autoAdvance) {
        window.clearInterval(autoAdvance);
        autoAdvance = null;
      }
    };

    const startAutoAdvance = () => {
      stopAutoAdvance();
      if (isDesktop() || isPaused || cards.length <= getVisibleCount()) return;

      autoAdvance = window.setInterval(() => {
        const nearEnd = viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 8;

        if (nearEnd) {
          viewport.scrollTo({ left: 0, behavior: "smooth" });
        } else {
          scrollReviews(1);
        }
      }, 9000);
    };

    const pauseCarousel = () => {
      isPaused = true;
      stopAutoAdvance();
    };

    const resumeCarousel = () => {
      isPaused = false;
      startAutoAdvance();
    };

    previous?.addEventListener("click", () => {
      scrollReviews(-1);
      startAutoAdvance();
    });

    next?.addEventListener("click", () => {
      scrollReviews(1);
      startAutoAdvance();
    });

    carousel.addEventListener("mouseenter", pauseCarousel);
    carousel.addEventListener("mouseleave", resumeCarousel);
    carousel.addEventListener("focusin", pauseCarousel);
    carousel.addEventListener("focusout", (event) => {
      if (!carousel.contains(event.relatedTarget)) resumeCarousel();
    });
    carousel.addEventListener("touchstart", pauseCarousel, { passive: true });
    carousel.addEventListener("touchend", resumeCarousel, { passive: true });

    let resizeTimer;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        viewport.scrollTo({ left: 0, behavior: "auto" });
        updateControls();
        startAutoAdvance();
      }, 150);
    });

    updateControls();
    startAutoAdvance();
  });
}

function renderServiceContent() {
  const services = getServices();
  if (!services.length) return;

  renderHomeServiceCards(services);
  renderServiceSelectOptions(services);
  renderServicesPage(services);
}

function renderServicesNavigation(services) {
  document.querySelectorAll("[data-services-nav]").forEach((container) => {
    container.innerHTML = services
      .map((service) => `<a href="services.html#${escapeAttribute(service.id)}">${escapeHtml(service.title)}</a>`)
      .join("");
  });
}

function renderHomeServiceCards(services) {
  document.querySelectorAll("[data-services-home]").forEach((container) => {
    container.innerHTML = services
      .map((service) => `
        <a class="service-link-card" href="services.html#${escapeAttribute(service.id)}">
          <h3>${escapeHtml(service.title)}</h3>
          <p>${escapeHtml(service.shortDescription || "")}</p>
        </a>
      `)
      .join("");
  });
}

function renderServiceSelectOptions(services) {
  document.querySelectorAll("[data-services-select]").forEach((select) => {
    const currentValue = select.value;
    select.innerHTML = '<option value="">Service Needed</option>';

    services.forEach((service) => {
      const option = document.createElement("option");
      option.value = service.requestOption || service.title;
      option.textContent = service.requestOption || service.title;
      select.appendChild(option);
    });

    const other = document.createElement("option");
    other.value = "Other";
    other.textContent = "Other";
    select.appendChild(other);

    if (currentValue) select.value = currentValue;
  });
}

function buildServiceRequestUrl(service) {
  const requestValue = service?.requestOption || service?.title || "";
  const query = requestValue ? `?service=${encodeURIComponent(requestValue)}` : "";
  return `contact.html${query}#request-service`;
}

function getRequestedServiceValue() {
  const params = new URLSearchParams(window.location.search);
  const rawService = params.get("service");
  if (!rawService) return "";

  const services = getServices();
  const normalized = normalizeForMatch(rawService);

  const matchedService = services.find((service) => {
    return [service.requestOption, service.title, service.id]
      .filter(Boolean)
      .some((value) => normalizeForMatch(value) === normalized);
  });

  return matchedService?.requestOption || matchedService?.title || rawService;
}

function applyRequestedServiceSelection(form) {
  const requestedService = getRequestedServiceValue();
  if (!requestedService) return;

  const serviceSelect = form.querySelector("select[name='service']");
  if (!serviceSelect) return;

  const options = Array.from(serviceSelect.options);
  const matchedOption = options.find((option) => {
    return normalizeForMatch(option.value) === normalizeForMatch(requestedService) ||
      normalizeForMatch(option.textContent) === normalizeForMatch(requestedService);
  });

  if (matchedOption) {
    serviceSelect.value = matchedOption.value;
  }
}

function normalizeForMatch(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function renderServicesPage(services) {
  document.querySelectorAll("[data-services-page]").forEach((container) => {
    container.innerHTML = services.map((service, index) => buildServiceDetailSection(service, index)).join("");
  });
}

function buildServiceDetailSection(service, index) {
  const isLight = index % 2 === 1;
  const sectionClass = isLight ? "section-light" : "section-paper";
  const reverseClass = isLight ? " service-detail-layout-reverse" : "";
  const paragraphs = Array.isArray(service.description) ? service.description : [service.description].filter(Boolean);
  const included = Array.isArray(service.included) ? service.included : [];
  const buttonHtml = service.isEmergency
    ? `<a href="#" data-phone-link class="button button-primary"><span data-phone-cta>${escapeHtml(service.requestButton || "Call")}</span></a>`
    : `<a href="${escapeAttribute(buildServiceRequestUrl(service))}" class="button button-primary">${escapeHtml(service.requestButton || "Request Service")}</a>`;

  return `
    <section id="${escapeAttribute(service.id)}" class="service-detail section ${sectionClass}">
      <div class="container service-detail-layout${reverseClass}">
        <div class="service-detail-image-wrap">
          <img src="${escapeAttribute(service.image || "")}" alt="${escapeAttribute(service.imageAlt || service.title || "Plumbing service")}" class="service-detail-image" />
        </div>
        <div class="service-detail-content">
          <p class="eyebrow">${escapeHtml(service.eyebrow || service.title)}</p>
          <h2>${escapeHtml(service.heading || service.title)}</h2>
          ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
          ${included.length ? `<ul class="service-list">${included.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
          ${buttonHtml}
        </div>
      </div>
    </section>
  `;
}

function initMobileNavigation() {
  const menuToggle = document.querySelector(".menu-toggle");
  const siteNav = document.querySelector(".site-nav");

  if (!menuToggle || !siteNav) return;

  menuToggle.addEventListener("click", () => {
    const isOpen = siteNav.classList.toggle("is-open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
  });

  siteNav.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link) return;

    siteNav.classList.remove("is-open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open menu");
  });
}

function initAnchorScrollOffset() {
  const header = document.querySelector(".site-header");

  function scrollToHash(hash) {
    if (!hash || hash === "#") return;

    const target = document.querySelector(hash);
    if (!target) return;

    const headerHeight = header ? header.offsetHeight : 0;
    const extraSpace = 18;
    const targetTop = target.getBoundingClientRect().top + window.pageYOffset - headerHeight - extraSpace;

    window.scrollTo({
      top: Math.max(targetTop, 0),
      behavior: "smooth"
    });
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link) return;

    const url = new URL(link.href, window.location.href);
    const isSamePage =
      url.origin === window.location.origin &&
      url.pathname.replace(/\/$/, "") === window.location.pathname.replace(/\/$/, "");

    if (!isSamePage || !url.hash) return;

    event.preventDefault();
    history.pushState(null, "", url.hash);
    scrollToHash(url.hash);
  });

  if (window.location.hash) {
    window.setTimeout(() => scrollToHash(window.location.hash), 80);
  }
}

function initServiceRequestForm() {
  const form = document.getElementById("request-service-form");
  if (!form) return;

  const config = getConfig();
  const status = document.getElementById("form-status");
  const scriptURL = config?.forms?.scriptURL;
  const submitButton = form.querySelector("button[type='submit']");
  const phoneInput = form.querySelector("input[name='phone']");
  const fileInput = form.querySelector("input[name='photoFiles']");
  const fileList = document.getElementById("file-list");

  if (phoneInput) {
    phoneInput.addEventListener("input", () => {
      phoneInput.value = formatPhoneNumber(phoneInput.value);
    });
  }

  if (fileInput && fileList) {
    fileInput.addEventListener("change", () => {
      renderSelectedFiles(fileInput.files, fileList);
    });
  }

  applyRequestedServiceSelection(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!scriptURL || scriptURL.includes("PASTE_YOUR_GOOGLE_APPS_SCRIPT")) {
      setStatus(status, buildErrorWithPhone(config?.forms?.notConfiguredMessage), "error");
      return;
    }

    setStatus(status, "Preparing your request...", "neutral");

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = config?.forms?.sendingButtonText || "Sending...";
    }

    try {
      const formData = new FormData(form);

      if (fileInput && fileInput.files.length > 0) {
        const photos = await filesToBase64(fileInput.files);
        formData.set("photos", JSON.stringify(photos));
      }

      setStatus(status, "Sending your request...", "neutral");

      await fetch(scriptURL, {
        method: "POST",
        body: formData,
        mode: "no-cors"
      });

      showSuccess(status);
      form.reset();

      if (fileList) {
        fileList.innerHTML = "";
      }
    } catch (error) {
      console.error("Cornerpost form error:", error);
      setStatus(status, error.message || buildErrorWithPhone(config?.forms?.genericErrorMessage), "error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = config?.forms?.requestButtonText || "Request Service";
      }
    }
  });
}

function buildErrorWithPhone(message) {
  const config = getConfig();
  const phone = config?.business?.phone?.display;
  return phone ? `${message || "Please call"} Please call ${phone}.` : (message || "Please call.");
}

function renderSelectedFiles(files, fileList) {
  fileList.innerHTML = "";

  const selectedFiles = Array.from(files);
  if (selectedFiles.length === 0) return;

  selectedFiles.slice(0, 3).forEach((file) => {
    const item = document.createElement("li");
    item.textContent = `${file.name} (${formatFileSize(file.size)})`;
    fileList.appendChild(item);
  });

  if (selectedFiles.length > 3) {
    const item = document.createElement("li");
    item.textContent = "Only the first 3 photos will be uploaded.";
    fileList.appendChild(item);
  }
}

function filesToBase64(files) {
  const maxFiles = 3;
  const maxSize = 5 * 1024 * 1024;
  const selectedFiles = Array.from(files).slice(0, maxFiles);

  return Promise.all(
    selectedFiles.map((file) => {
      if (file.size > maxSize) {
        throw new Error(`${file.name} is too large. Maximum file size is 5 MB.`);
      }

      if (!file.type.startsWith("image/")) {
        throw new Error(`${file.name} is not an image file.`);
      }

      return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
          const result = String(reader.result);
          const base64Data = result.split(",")[1];

          resolve({
            name: file.name,
            mimeType: file.type,
            data: base64Data
          });
        };

        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
    })
  );
}

function formatPhoneNumber(value) {
  const digits = value.replace(/\D/g, "").slice(0, 10);

  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setStatus(element, message, type) {
  if (!element) return;

  element.className = `form-status form-status-${type}`;
  element.textContent = message;
}

function showSuccess(element) {
  if (!element) return;

  const config = getConfig();
  const forms = config?.forms || {};
  const business = config?.business || {};
  const phone = business.phone || {};
  const urgentInstruction = business.availability?.urgentInstruction || "If your plumbing issue is urgent, please call immediately:";

  element.className = "form-status form-status-card";
  element.innerHTML = `
    <h3>${escapeHtml(forms.successTitle || "✓ Request Sent!")}</h3>
    <p>${escapeHtml(forms.successMessage || "Thank you for contacting us.")}</p>
    <p>${escapeHtml(forms.successEmailReminder || "Please check your email for confirmation and reference number.")}</p>
    <p><strong>${escapeHtml(urgentInstruction)}</strong></p>
    <p><strong><a href="tel:${escapeAttribute(phone.digits || "")}">${escapeHtml(phone.display || "Call")}</a></strong></p>
  `;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
