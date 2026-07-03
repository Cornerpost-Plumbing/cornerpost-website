document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("request-service-form");
  if (!form) return;

  const status = document.getElementById("form-status");
  const scriptURL = form.dataset.scriptUrl;
  const submitButton = form.querySelector("button[type='submit']");
  const phoneInput = form.querySelector("input[name='phone']");

  if (phoneInput) {
    phoneInput.addEventListener("input", () => {
      phoneInput.value = formatPhoneNumber(phoneInput.value);
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!scriptURL || scriptURL.includes("PASTE_YOUR_GOOGLE_APPS_SCRIPT")) {
      setStatus(status, "The form is not configured yet. Please call 308-225-3392.", "error");
      return;
    }

    setStatus(status, "Sending your request...", "neutral");
    submitButton.disabled = true;
    submitButton.textContent = "Sending...";

    const formData = new FormData(form);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(scriptURL, {
        method: "POST",
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeout);

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unknown form submission error");
      }

      setStatus(status, "Thank you. Your request has been sent.", "success");
      form.reset();
    } catch (error) {
      console.error("Cornerpost form error:", error);

      if (error.name === "AbortError") {
        setStatus(status, "The request timed out. Please call 308-225-3392.", "error");
      } else {
        setStatus(status, "Something went wrong. Please call 308-225-3392.", "error");
      }
    } finally {
      clearTimeout(timeout);
      submitButton.disabled = false;
      submitButton.textContent = "Request Service";
    }
  });
});

function formatPhoneNumber(value) {
  const digits = value.replace(/\D/g, "").slice(0, 10);

  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function setStatus(element, message, type) {
  if (!element) return;

  element.textContent = message;

  if (type === "success") {
    element.style.color = "#2c312b";
  } else if (type === "error") {
    element.style.color = "#b03030";
  } else {
    element.style.color = "#66685f";
  }
}
