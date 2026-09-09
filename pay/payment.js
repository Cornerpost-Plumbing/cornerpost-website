(() => {
  "use strict";

  const PAYMENT_API_URL =
    "https://script.google.com/macros/s/AKfycbz5_XXSjOHZLWTy9KbqhgHCRwnGfCa9rFMHsgp992VEZvAQmCczBCTMl7vUiGRSUP7Bvg/exec";

  const els = {
    status: document.getElementById("payment-status"),
    content: document.getElementById("payment-content"),
    titleNumber: document.getElementById("invoice-title-number"),
    invoiceNumber: document.getElementById("invoice-number"),
    invoiceDate: document.getElementById("invoice-date"),
    balanceDue: document.getElementById("balance-due"),
    paymentOptions: document.querySelector(".payment-options"),
    businessName: document.getElementById("business-name"),
    businessPhone: document.getElementById("business-phone"),
    businessEmail: document.getElementById("business-email")
  };

  function getPaymentToken() {
    const token = new URLSearchParams(window.location.search).get("t");
    return token && /^[0-9a-f]{64}$/i.test(token) ? token : "";
  }

  function showStatus(message, kind = "info") {
    els.status.textContent = message;
    els.status.dataset.kind = kind;
    els.status.hidden = false;
  }

  function showContent() {
    els.status.hidden = true;
    els.content.hidden = false;
  }

  function setBusinessContact(business) {
    if (!business || typeof business !== "object") return;

    if (business.name) {
      els.businessName.textContent = business.name;
    }

    if (business.phone) {
      els.businessPhone.textContent = business.phone;
      els.businessPhone.href = "tel:" + business.phone.replace(/[^\d+]/g, "");
    }

    if (business.email) {
      els.businessEmail.textContent = business.email;
      els.businessEmail.href = "mailto:" + business.email;
    }
  }

  async function postPaymentAction(payload) {
    const response = await fetch(PAYMENT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      credentials: "omit",
      redirect: "follow",
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error("Payment service request failed.");
    }

    return response.json();
  }

  function renderPayable(context, checkout) {
    els.titleNumber.textContent = context.invoiceNumber;
    els.invoiceNumber.textContent = context.invoiceNumber;
    els.invoiceDate.textContent = context.invoiceDate;
    els.balanceDue.textContent = context.balanceDue;
    setBusinessContact(context.business);

    // Checkout wiring is the next stage. Until then, do not allow a button
    // to imply that payment processing is active on this static frontend.
    document.querySelectorAll(".payment-button").forEach((button) => {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
    });

    if (!checkout || checkout.enabled !== true) {
      els.paymentOptions.hidden = true;
    }

    showContent();
  }

  function renderSettled(context) {
    els.titleNumber.textContent = context.invoiceNumber || "";
    els.invoiceNumber.textContent = context.invoiceNumber || "—";
    els.invoiceDate.textContent = context.invoiceDate || "—";
    els.balanceDue.textContent = context.balanceDue || "$0.00";
    setBusinessContact(context.business);
    els.paymentOptions.hidden = true;
    showContent();

    const paidText = context.paidOn
      ? `This invoice was paid on ${context.paidOn}. No payment is due.`
      : "This invoice has already been paid. No payment is due.";

    showStatus(paidText, "success");
    els.status.hidden = false;
  }

  function renderUnavailable(context) {
    if (context && context.invoiceNumber) {
      els.titleNumber.textContent = context.invoiceNumber;
    }
    if (context && context.business) {
      setBusinessContact(context.business);
    }
    els.content.hidden = true;
    showStatus(
      "This invoice is not currently available for online payment. Please contact Cornerpost Plumbing if you have questions.",
      "notice"
    );
  }

  async function loadInvoice() {
    const token = getPaymentToken();

    if (!token) {
      showStatus(
        "This payment link is incomplete or invalid. Please use the payment link from your invoice email.",
        "error"
      );
      return;
    }

    try {
      const response = await postPaymentAction({
        action: "context",
        token
      });

      if (!response || response.transport !== "ok" || response.action !== "context") {
        throw new Error("Unexpected payment service response.");
      }

      const context = response.result;

      if (!context || context.found !== true) {
        showStatus(
          "We could not find an invoice for this payment link. Please check the link in your invoice email or contact Cornerpost Plumbing.",
          "error"
        );
        return;
      }

      if (context.state === "payable") {
        renderPayable(context, response.checkout);
        return;
      }

      if (context.state === "settled") {
        renderSettled(context);
        return;
      }

      renderUnavailable(context);
    } catch (error) {
      // Never expose internal error details or the token to the customer.
      showStatus(
        "We are unable to load this invoice right now. Please try again in a few minutes or contact Cornerpost Plumbing.",
        "error"
      );
    }
  }

  loadInvoice();
})();
