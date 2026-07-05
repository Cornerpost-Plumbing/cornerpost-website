document.addEventListener("DOMContentLoaded", () => {
  initMobileNavigation();
  initServiceRequestForm();
});

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

function initServiceRequestForm() {
  const form = document.getElementById("request-service-form");
  if (!form) return;

  const status = document.getElementById("form-status");
  const scriptURL = form.dataset.scriptUrl;
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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!scriptURL || scriptURL.includes("PASTE_YOUR_GOOGLE_APPS_SCRIPT")) {
      setStatus(status, "The form is not configured yet. Please call 308-225-3392.", "error");
      return;
    }

    setStatus(status, "Preparing your request...", "neutral");

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Sending...";
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
      setStatus(status, error.message || "Something went wrong. Please call 308-225-3392.", "error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Request Service";
      }
    }
  });
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

  element.className = "form-status form-status-card";
  element.innerHTML = `
    <h3>✓ Request Sent!</h3>
    <p>Thank you for contacting <strong>Cornerpost Plumbing</strong>.</p>
    <p>We've received your request and will contact you as soon as possible.</p>
    <p><strong>If your plumbing issue is urgent, please call immediately:</strong></p>
    <p><strong><a href="tel:3082253392">308-225-3392</a></strong></p>
  `;
}
