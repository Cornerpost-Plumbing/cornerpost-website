(() => {
  "use strict";

  /**
   * Cornerpost invoice payment page.
   *
   * THIS FILE HAS NO AUTHORITY OVER ANYTHING. It cannot decide what is
   * owed, cannot decide that a payment happened, and cannot mark an
   * invoice paid. Everything it knows about money it was told by the
   * server after the server asked Cornerpost and PayPal. What it does is
   * offer the ways to pay that are genuinely available on this device,
   * hand back an order id, and say calm true things to a person.
   *
   * IT NEVER SENDS AN AMOUNT OR AN INVOICE. The only fields the transport
   * reads are action, token and orderId. If somebody opened the console
   * and changed every number on this page, every order would still be
   * created for what the Cornerpost workbook says is owed, because the
   * server reads that figure again at the moment the order is opened.
   *
   * ONE PROCESSOR, ONE SETTLEMENT PATH. PayPal, Venmo and Google Pay are
   * three ways for a customer to authorise the SAME PayPal order. Every
   * one of them ends at settle(), which is the only route to Cornerpost,
   * and Cornerpost records the capture exactly once whichever was used.
   *
   * ELIGIBILITY DECIDES WHAT IS SHOWN. A method this buyer, device,
   * browser or account cannot actually use is hidden -- never a disabled
   * button that looks like it should have worked.
   *
   * Ported from the proven Apps Script frontend (PaymentPageJS.html).
   * Only the transport changed: google.script.run became a POST, because
   * that API exists only inside HtmlService. No processor behaviour was
   * altered because the host changed.
   */

  /* SANDBOX ONLY. THIS IS THE PREVIEW COPY, NOT THE CUSTOMER PAGE.

     This file exists because Apple verifies the ORIGIN showing an Apple
     Pay button against the domain-association file served from
     /.well-known/ on that host. cornerpostplumbing.com is registered, so
     Apple Pay can be exercised from a path on this host and from nowhere
     else -- localhost cannot work. /pay-preview/ is that path: unlinked,
     noindex, and pointed at Sandbox.

     THE CUSTOMER PAGE AT /pay/ IS NOT THIS FILE AND IS NOT AFFECTED BY IT.

     Deployment @16, Cornerpost Invoice Payment 5.3.167 -- Sandbox. This
     is the CURRENT Sandbox deployment, and deliberately not the one /pay/
     still names: that is @13 (5.3.159), which predates both the checkout
     kill switch (5.3.162) and NO_SHIPPING (5.3.165), so it could not
     preserve either. Sandbox cannot move real money. */
  const PAYMENT_API_URL =
    "https://script.google.com/macros/s/AKfycbyck8IT4vr2tzqdXTHkq2PDM8OMtzCTZwxPhl4q_OtFVSzlo8TtkJy1UVkND11opePpzw/exec";

  const GOOGLE_PAY_SDK_URL = "https://pay.google.com/gp/p/js/pay.js";

  /* Apple's own library. PayPal supplies the merchant side; the sheet
     itself is Apple's, and only Safari on Apple hardware has it. */
  const APPLE_PAY_SDK_URL =
    "https://applepay.cdn-apple.com/jsapi/v1/apple-pay-sdk.js";

  /* Apple Pay asks for these; PayPal's config() supplies only the
     capabilities and networks. Cornerpost is a US plumbing company
     billing in USD -- the same assumption Venmo already makes. */
  const APPLE_PAY_COUNTRY = "US";
  const APPLE_PAY_CURRENCY = "USD";

  /* The ApplePayJS version this integration is written against. */
  const APPLE_PAY_VERSION = 4;

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

  /** So a double tap cannot open two checkouts. */
  let busy = false;

  /** Set once a payment is known to have been recorded. */
  let settled = false;

  /** The most recent server answer, for the sheet that must show a total. */
  let lastOrder = null;

  function getPaymentToken() {
    const token = new URLSearchParams(window.location.search).get("t");
    return token && /^[0-9a-f]{64}$/i.test(token) ? token : "";
  }

  function showStatus(message, kind = "info") {
    els.status.textContent = message;
    els.status.dataset.kind = kind;
    els.status.hidden = false;
  }

  function hideStatus() {
    els.status.hidden = true;
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

  /**
   * The transport. A CORS SIMPLE REQUEST, and that is a constraint rather
   * than a preference: /exec answers with a redirect that a browser will
   * follow for a simple request, but a CORS preflight does not follow
   * redirects. text/plain and no custom headers is what makes this work.
   */
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

  /* ── What the page says, and never says ──────────────────────────── */

  /**
   * Every refusal the server can give, in words a customer can act on.
   *
   * NOT ONE OF THESE INVITES A SECOND PAYMENT except where the server has
   * confirmed that nothing was charged. The vocabulary is the server's --
   * these are the same reasons the Apps Script page rendered.
   */
  const REASONS = {
    unavailable: [
      "Checkout unavailable",
      "Online payment is not available for this invoice right now. Please contact us and we will be glad to help."
    ],
    settled: [
      "Already paid",
      "This invoice has no balance due. Nothing has been charged."
    ],
    notfound: [
      "Link not recognized",
      "This payment link is no longer valid. Please contact us for a current link."
    ],
    amountchanged: [
      "Balance changed",
      "The balance on this invoice changed while the checkout was open, so nothing was charged. Please reload this page to pay the current amount."
    ],
    unverified: [
      "Not completed",
      "That checkout could not be verified, so nothing has been charged. Please reload this page and try again."
    ],
    failed: [
      "Checkout unavailable",
      "The checkout could not be opened. Nothing has been charged. Please try again shortly."
    ],
    /**
     * THE ONE STATE THAT MUST NOT SUGGEST RETRYING.
     *
     * The server could not establish whether money moved. Repeating the
     * SAME order is harmless -- the capture id records once -- but a
     * person told "try again" starts a NEW checkout, and that would
     * genuinely pay twice.
     */
    uncertain: [
      "Please contact us",
      "We could not confirm the result of this payment. Please do not submit another payment. Contact Cornerpost Plumbing and we will confirm exactly what was received."
    ]
  };

  /**
   * Reports a refusal.
   *
   * The server may also send a diagnostic naming which step failed. It is
   * written to the console for an operator and deliberately NOT shown to
   * the customer: it names processor internals, and a person paying a
   * plumbing bill should never be shown one.
   */
  function refuse(reason, diagnostic) {
    const said = REASONS[reason] || REASONS.uncertain;
    if (diagnostic) {
      console.warn("[Cornerpost payment] " + reason + " (" + diagnostic + ")");
    }
    if (reason !== "amountchanged" && reason !== "unverified" &&
        reason !== "failed") {
      hideCheckout();
    }
    showStatus(said[0] + ". " + said[1],
      reason === "uncertain" ? "error" : "notice");
  }

  function hideCheckout() {
    if (els.paymentOptions) els.paymentOptions.hidden = true;
  }

  function eachButton(fn) {
    document.querySelectorAll(".payment-button").forEach(fn);
  }

  /** Locks every control while one checkout is in flight. */
  function setBusy(value) {
    busy = value;
    eachButton((button) => {
      if (button.hidden) return;
      button.disabled = value || settled;
      button.setAttribute("aria-disabled", String(value || settled));
    });
  }

  /* ── Invoice state ───────────────────────────────────────────────── */

  function renderInvoice(context) {
    els.titleNumber.textContent = context.invoiceNumber || "";
    els.invoiceNumber.textContent = context.invoiceNumber || "—";
    /* invoiceDate and balanceDue arrive ALREADY FORMATTED, by the same
       formatters the invoice PDF and the invoice email use. Reformatting
       them here is how a payment page comes to disagree with the bill. */
    els.invoiceDate.textContent = context.invoiceDate || "—";
    els.balanceDue.textContent = context.balanceDue || "—";
    setBusinessContact(context.business);
  }

  function renderPayable(context, checkout) {
    renderInvoice(context);

    /* Nothing is offered until the SDK says a method is genuinely usable.
       The whole panel starts hidden too, so a customer never reads
       'choose how you would like to pay' above an empty space while the
       SDK is still deciding what this device can actually use. */
    eachButton((button) => { button.hidden = true; });
    hideCheckout();
    showContent();

    if (!checkout || checkout.enabled !== true) {
      /* 5.3.162: SAY SOMETHING. This branch used to hide the checkout and
         return in silence, so a customer met their balance with no way to
         pay it and nothing to read -- indistinguishable from a page that
         had broken half way through loading. The server decides whether a
         checkout may be offered; when it says no, the only honest thing to
         do is say so calmly and point at the route that still works.

         WHY it is unavailable is never said: an outage, a thrown kill
         switch and a missing credential are the same fact to the person
         reading this, and the difference is an operator's business. */
      hideCheckout();
      showStatus(
        "Online payment is temporarily unavailable for this invoice. Nothing has been charged. The payment instructions on your invoice explain how to pay by mail, or you can contact us using the details below.",
        "notice"
      );
      return;
    }

    startCheckout(checkout);
  }

  function renderSettled(context) {
    settled = true;
    renderInvoice(context);
    hideCheckout();
    els.content.hidden = false;

    showStatus(
      context.paidOn
        ? `This invoice was paid on ${context.paidOn}. No payment is due.`
        : "This invoice has already been paid. No payment is due.",
      "success"
    );
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

  /* ── The checkout ────────────────────────────────────────────────── */

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Script failed to load."));
      document.head.appendChild(script);
    });
  }

  function checkoutUnavailable(message) {
    hideCheckout();
    showStatus(message, "notice");
    els.content.hidden = false;
  }

  /**
   * Boots the SDK and offers only what is genuinely eligible.
   *
   * THE SDK ORIGIN AND CLIENT ID COME FROM THE SERVER, so Sandbox and
   * Live remain one fact in one place -- the payment project's Script
   * Properties -- rather than being hard-coded into this repository.
   */
  async function startCheckout(checkout) {
    try {
      /* Google decides whether the DEVICE can pay; its library is loaded
         alongside PayPal's, and its absence costs only Google Pay. */
      await Promise.all([
        loadScript(checkout.sdkOrigin + "/web-sdk/v6/core"),
        loadScript(GOOGLE_PAY_SDK_URL).catch(() => {}),
        /* Apple's library is absent everywhere except Safari on Apple
           devices, and its absence costs only Apple Pay. */
        loadScript(APPLE_PAY_SDK_URL).catch(() => {})
      ]);

      if (!window.paypal || !window.paypal.createInstance) {
        checkoutUnavailable(
          "Online checkout could not be loaded in this browser. Payment instructions on your invoice explain how to pay by mail."
        );
        return;
      }

      /**
       * THREE COMPONENTS, ONE PROCESSOR. Each is a way for the customer
       * to authorise the same PayPal order.
       *
       * applepay-payments is deliberately absent: Apple requires a domain
       * association file served from /.well-known/ on the domain showing
       * the button, and that is not part of this pass.
       */
      const sdk = await window.paypal.createInstance({
        clientId: checkout.clientId,
        components: ["paypal-payments", "venmo-payments",
          "googlepay-payments", "applepay-payments"],
        pageType: "checkout"
      });

      const methods = await sdk.findEligibleMethods({ currencyCode: "USD" });
      await renderMethods(sdk, methods, checkout.googlePayEnvironment);
    } catch (error) {
      checkoutUnavailable(
        "Online checkout could not be started. Nothing has been charged. Payment instructions on your invoice explain how to pay by mail."
      );
    }
  }

  /** True only when the SDK says this buyer really can use the method. */
  function eligible(methods, key) {
    try {
      return !!(methods && methods.isEligible(key));
    } catch (error) {
      /* An SDK that does not know a key is telling us it is not eligible. */
      return false;
    }
  }

  function buttonFor(method) {
    return document.querySelector('.payment-button[data-payment-method="' +
      method + '"]');
  }

  function offer(method, onClick) {
    const button = buttonFor(method);
    if (!button) return false;
    button.hidden = false;
    button.disabled = false;
    button.setAttribute("aria-disabled", "false");
    button.addEventListener("click", onClick);
    return true;
  }

  async function renderMethods(sdk, methods, googlePayEnvironment) {
    let offered = 0;

    if (eligible(methods, "googlepay")) {
      /* Asynchronous: Google itself decides whether this device can pay,
         and only then does a button appear. */
      if (await addGooglePay(sdk, googlePayEnvironment)) offered += 1;
    }

    /* 5.3.169: APPLE PAY, THIRD, AND ONLY WHERE IT CAN ACTUALLY WORK.
       Three gates, all required: PayPal says the merchant is eligible,
       the browser has ApplePaySession at all, and Apple says this
       device can make payments. Any one of them false and the button
       is absent -- never a disabled imitation. */
    if (eligible(methods, "applepay")) {
      if (await addApplePay(sdk)) offered += 1;
    }

    if (eligible(methods, "venmo")) {
      offered += offer("venmo", () => openSession(
        "venmo",
        /* 'auto' is the only presentation mode Venmo supports. */
        () => sdk.createVenmoOneTimePaymentSession(sessionOptions())
      )) ? 1 : 0;
    }

    if (eligible(methods, "paypal")) {
      offered += offer("paypal", () => openSession(
        "paypal",
        () => sdk.createPayPalOneTimePaymentSession(sessionOptions())
      )) ? 1 : 0;
    }


    if (!offered) {
      checkoutUnavailable(
        "Online payment is not available in this browser. Payment instructions on your invoice explain how to pay by mail."
      );
      return;
    }

    /* At least one method is genuinely usable, so the panel earns its
       place on the page. */
    if (els.paymentOptions) els.paymentOptions.hidden = false;
    hideStatus();
    els.content.hidden = false;

    resumeIfReturning(sdk);
  }

  /** The callbacks every session shares. One set, one settlement path. */
  function sessionOptions() {
    return {
      onApprove: (data) => {
        showStatus(
          "Confirming your payment with the bank. Please do not close this page.",
          "info"
        );
        return settle(data && data.orderId);
      },
      onCancel: () => {
        /* The buyer backed out. Nothing moved, and saying so is the
           difference between a calm page and an alarming one. It is not
           an error and needs no office intervention. */
        if (!settled) {
          showStatus(
            "The checkout was closed and nothing has been charged. You can start again whenever you are ready.",
            "notice"
          );
        }
      },
      onError: () => {
        if (!settled) refuse("unverified");
      },
      /* 5.3.167: the SDK’s warnings were being discarded entirely.
         Operator diagnostics only -- a warning is not a refusal, so
         the customer is told nothing. */
      onWarn: (warning) => {
        console.warn("[Cornerpost payment] SDK warning: " +
          ((warning && warning.message) || warning));
      }
    };
  }

  /**
   * Asks the server to open an order. Returns what the SDK expects.
   *
   * THE ONLY THING SENT IS THE TOKEN. There is no amount and no invoice
   * in this request, and the server would not read one if there were.
   */
  /** An error whose reason the customer has already been told. */
  function reportedError() {
    const e = new Error("createOrder");
    e.cpReported = true;
    return e;
  }

  async function createOrder() {
    const answer = await postPaymentAction({
      action: "createOrder",
      token: getPaymentToken()
    });

    if (!answer || answer.transport !== "ok") {
      refuse("failed", answer && answer.reason);
      throw reportedError();
    }

    const result = answer.result;
    if (!result || result.ok !== true) {
      /* The server decided. A balance that moved, an invoice that is no
         longer payable -- none of that is reconciled here. */
      refuse((result && result.reason) || "failed", result && result.diagnostic);
      throw reportedError();
    }

    hideStatus();
    lastOrder = result;
    return { orderId: result.orderId };
  }

  /**
   * Asks the server what really happened. THE BROWSER IS ONLY A TRIGGER.
   *
   * EVERY METHOD ENDS HERE. A failure of this CALL is not a failure of
   * the payment -- the answer may have been lost on the way back, after
   * the server recorded it -- so it is reported as uncertain rather than
   * as a decline, and never invites another attempt.
   */
  async function settle(orderId) {
    try {
      const answer = await postPaymentAction({
        action: "settle",
        token: getPaymentToken(),
        orderId: orderId
      });

      if (!answer || answer.transport !== "ok") {
        refuse("uncertain", "CLIENT_NO_ANSWER");
        return;
      }

      const result = answer.result;
      if (!result || result.recorded !== true) {
        refuse((result && result.reason) || "uncertain",
          result && result.diagnostic);
        return;
      }

      await recorded(result);
    } catch (error) {
      refuse("uncertain", "CLIENT_NO_ANSWER");
    }
  }

  /**
   * A payment the server has recorded. Including a replay of one it had
   * already recorded -- the capture id makes that the same answer, not a
   * second payment.
   *
   * THE PAGE THEN ASKS CORNERPOST AGAIN rather than trusting the picture
   * it was handed, so what a customer finally reads is a fresh
   * authoritative read.
   *
   * readModelUnavailable means the money is DURABLE and only the picture
   * failed. It is reported as the success it is.
   */
  async function recorded(result) {
    settled = true;
    setBusy(false);
    hideCheckout();

    try {
      const fresh = await postPaymentAction({
        action: "context",
        token: getPaymentToken()
      });
      const context = fresh && fresh.transport === "ok" ? fresh.result : null;
      if (context && context.found === true) {
        renderInvoice(context);
        showStatus(
          context.state === "settled"
            ? "Thank you. Your payment has been received and this invoice is paid in full."
            : `Thank you. Your payment has been received. Balance due is now ${context.balanceDue}.`,
          "success"
        );
        els.content.hidden = false;
        return;
      }
    } catch (error) {
      /* The payment stands. Only the refresh failed. */
    }

    showStatus(
      "Thank you. Your payment has been received and recorded. This page could not be refreshed just now; your account is up to date.",
      "success"
    );
    els.content.hidden = false;
  }

  /**
   * A method whose whole flow is session.start -- PayPal and Venmo.
   */
  function openSession(method, makeSession) {
    if (busy || settled) return;
    setBusy(true);
    showStatus("Opening checkout. One moment.", "info");

    const session = makeSession();
    /**
     * start() is given a PROMISE of an order id. If the server refuses,
     * createOrder rejects and the checkout never opens -- so a refusal
     * cannot become a half-open payment window.
     *
     * targetElement WAS PASSED HERE AND IS NOT ANY MORE (5.3.168). It
     * exists to position an OVERLAY, and the dedicated guest card was
     * the only method that rendered one into this page; PayPal and
     * Venmo open a window of their own and never needed it. It left
     * with the method it was added for.
     */
    Promise.resolve(session.start({ presentationMode: "auto" },
      createOrder()))
      .catch(launchFailed)
      .then(() => { setBusy(false); });
  }

  /**
   * A CHECKOUT THAT WOULD NOT OPEN MUST SAY SO (5.3.167).
   *
   * This catch used to be empty, on the assumption that whatever went
   * wrong had already been reported -- by createOrder for a server
   * refusal, or by the session’s own onError. That assumption held for
   * PayPal and Venmo and was FALSE for the method that failed: a customer pressed
   * the button, saw "Opening checkout", waited, and was returned to an
   * idle page with no message and nothing in the console. An empty catch
   * is not error handling; it is a decision to discard the only evidence
   * there was.
   *
   * A refusal is not reported twice: createOrder marks the error it
   * throws, because it has already said something truer than this.
   */
  function launchFailed(error) {
    if (error && error.cpReported) return;
    if (settled) return;
    console.warn("[Cornerpost payment] checkout did not open: " +
      ((error && error.message) || error));
    refuse("failed");
  }

  /**
   * GOOGLE PAY, WHICH IS SHAPED DIFFERENTLY.
   *
   * Google's own library decides whether this device can pay, so the
   * button appears only after Google says yes -- PayPal's eligibility
   * answer is necessary but not sufficient.
   *
   * The order is created BEFORE the sheet opens, because Google's sheet
   * has to display a total. That total is read back from the answer the
   * SERVER gave for the order it had just created; it is never composed
   * here, and it is not what anybody is charged -- the PayPal order is.
   */
  /**
   * APPLE PAY (5.3.169).
   *
   * WEBSITE ONLY, AND THAT IS STRUCTURAL. Apple verifies the ORIGIN
   * showing the button against a domain-association file served from
   * /.well-known/ on that domain. cornerpostplumbing.com serves one and
   * is registered; the Apps Script page is served from Google's domain
   * at a path Cornerpost cannot add files to, so Apple Pay can never be
   * offered there and is not asked for there.
   *
   * NOTHING SHIPS. Cornerpost sells plumbing work, so the payment
   * request omits requiredShippingContactFields and shippingMethods
   * entirely. Apple asks a buyer for a shipping address only when the
   * merchant asks for one, so the way not to ask is not to ask.
   */
  async function addApplePay(sdk) {
    /* ONE GATE, NOT TWO. Only Safari on Apple hardware has the API at all,
       and having it is not the same as having a card in the wallet -- but
       both answers are the same answer here, so they are asked once. A
       separate `if (!window.ApplePaySession)` above this would be a second
       guard covering the identical outcome, and redundant guards hide each
       other. Some browsers throw rather than answer; a throw is a no. */
    let walletReady = false;
    try {
      walletReady = !!window.ApplePaySession &&
        window.ApplePaySession.canMakePayments() === true;
    } catch (error) {
      walletReady = false;
    }
    if (!walletReady) return false;

    try {
      const session = await sdk.createApplePayOneTimePaymentSession(
        sessionOptions());
      const config = await session.config();
      return offer("apple-pay", () => openApplePay(session, config));
    } catch (error) {
      /* Apple Pay could not be prepared -- most often a merchant or
         domain that is not provisioned. The other methods are
         unaffected and the customer is never told about a button they
         did not see. */
      return false;
    }
  }

  /**
   * THE ORDER IS CREATED IN PARALLEL, NOT FIRST, AND THAT IS REQUIRED.
   *
   * ApplePaySession.begin() must be called inside the user gesture that
   * started it. Awaiting our server before begin() would spend the
   * gesture and Apple would refuse to open the sheet -- so the order is
   * started here and awaited later, in onpaymentauthorized, where there
   * is no gesture left to lose.
   *
   * WHICH MEANS THE SHEET SHOWS THE BALANCE THIS PAGE WAS LOADED WITH.
   * That figure is display only, exactly as Google Pay's is. The amount
   * actually charged is the PayPal order the SERVER created from the
   * workbook at the moment of asking, and if the balance moved in
   * between, settlement refuses and nothing is captured.
   */
  function openApplePay(session, config) {
    if (busy || settled) return;
    setBusy(true);
    showStatus("Opening checkout. One moment.", "info");

    const orderPromise = createOrder();
    /* A rejection here is reported by createOrder itself; this keeps it
       from also surfacing as an unhandled rejection. */
    orderPromise.catch(() => {});

    let apple;
    try {
      apple = new window.ApplePaySession(APPLE_PAY_VERSION, {
        countryCode: APPLE_PAY_COUNTRY,
        currencyCode: APPLE_PAY_CURRENCY,
        merchantCapabilities: config.merchantCapabilities,
        supportedNetworks: config.supportedNetworks,
        /* No requiredShippingContactFields and no shippingMethods: a
           plumbing invoice ships nothing. */
        total: {
          label: els.businessName.textContent || "Cornerpost Plumbing",
          type: "final",
          amount: appleTotal()
        }
      });
    } catch (error) {
      launchFailed(error);
      setBusy(false);
      return;
    }

    apple.onvalidatemerchant = (event) => {
      session.validateMerchant({ validationUrl: event.validationURL })
        .then((payload) => {
          apple.completeMerchantValidation(payload.merchantSession);
        })
        .catch((error) => {
          launchFailed(error);
          try { apple.abort(); } catch (ignored) { /* already closed */ }
          setBusy(false);
        });
    };

    apple.onpaymentauthorized = (event) => {
      orderPromise
        .then((order) => session.confirmOrder({
          orderId: order.orderId,
          token: event.payment.token,
          billingContact: event.payment.billingContact
        }).then(() => order.orderId))
        .then((orderId) => {
          showStatus(
            "Confirming your payment with the bank. Please do not close this page.",
            "info"
          );
          return settle(orderId);
        })
        .then(() => {
          apple.completePayment({
            status: settled
              ? window.ApplePaySession.STATUS_SUCCESS
              : window.ApplePaySession.STATUS_FAILURE
          });
        })
        .catch(() => {
          /* Whatever failed has already told the customer; Apple only
             needs to be told the sheet is finished. */
          apple.completePayment({
            status: window.ApplePaySession.STATUS_FAILURE
          });
        })
        .then(() => { setBusy(false); });
    };

    apple.oncancel = () => {
      setBusy(false);
      if (!settled) {
        showStatus(
          "The checkout was closed and nothing has been charged. You can start again whenever you are ready.",
          "notice"
        );
      }
    };

    apple.begin();
  }

  /**
   * What Apple's sheet displays. DISPLAY ONLY -- see openApplePay.
   *
   * Read back off the page, which got it from the server, and stripped
   * of the formatting a person reads. Apple wants a bare decimal.
   */
  function appleTotal() {
    const shown = (els.balanceDue.textContent || "").replace(/[^0-9.]/g, "");
    return shown || "0.00";
  }

  async function addGooglePay(sdk, googlePayEnvironment) {
    if (!window.google || !window.google.payments || !window.google.payments.api) {
      return false;   /* Google's library did not load. No button. */
    }

    try {
      const session = sdk.createGooglePayOneTimePaymentSession(sessionOptions());
      const config = await session.getGooglePayConfig();

      const client = new window.google.payments.api.PaymentsClient({
        environment: googlePayEnvironment,
        paymentDataCallbacks: {
          onPaymentAuthorized: (paymentData) =>
            googlePayAuthorized(session, paymentData)
        }
      });

      const ready = await client.isReadyToPay({
        apiVersion: config.apiVersion,
        apiVersionMinor: config.apiVersionMinor,
        allowedPaymentMethods: config.allowedPaymentMethods
      });
      if (!ready || !ready.result) return false;   /* device cannot pay */

      return offer("google-pay", () => openGooglePay(client, config));
    } catch (error) {
      /* Google Pay could not be prepared. The other methods are
         unaffected and the customer is not told about a button they
         never saw. */
      return false;
    }
  }

  function openGooglePay(client, config) {
    if (busy || settled) return;
    setBusy(true);
    showStatus("Opening checkout. One moment.", "info");

    createOrder()
      .then(() => client.loadPaymentData({
        apiVersion: config.apiVersion,
        apiVersionMinor: config.apiVersionMinor,
        allowedPaymentMethods: config.allowedPaymentMethods,
        merchantInfo: config.merchantInfo,
        /* DISPLAY ONLY. The authoritative amount is the server-created
           order; this is what Google shows the buyer, and it is the
           server's own figure for that same order. */
        transactionInfo: {
          countryCode: config.countryCode,
          currencyCode: "USD",
          totalPriceStatus: "FINAL",
          totalPrice: (lastOrder && lastOrder.displayTotal) || "0.00"
        },
        callbackIntents: ["PAYMENT_AUTHORIZATION"]
      }))
      .catch(() => {
        /* Cancelled, or already reported by createOrder. */
        if (!settled) hideStatus();
      })
      .then(() => { setBusy(false); });
  }

  /**
   * Google says the buyer authorised. THAT IS STILL NOT PAYMENT.
   *
   * confirmOrder attaches the Google Pay credential to the PayPal order,
   * and then the SAME settle() every other method uses asks the server
   * what really happened. Google is told SUCCESS only once Cornerpost has
   * answered, so its sheet never claims more than the server does.
   */
  function googlePayAuthorized(session, paymentData) {
    const orderId = lastOrder && lastOrder.orderId;
    if (!orderId) return { transactionState: "ERROR" };

    showStatus(
      "Confirming your payment with the bank. Please do not close this page.",
      "info"
    );

    return Promise.resolve(session.confirmOrder({
      orderId: orderId,
      paymentMethodData: paymentData && paymentData.paymentMethodData
    }))
      .then(() => settle(orderId))
      .then(() => ({ transactionState: settled ? "SUCCESS" : "ERROR" }))
      .catch(() => ({ transactionState: "ERROR" }));
  }

  /**
   * A BUYER WHO WAS SENT AWAY AND CAME BACK.
   *
   * The redirect presentation leaves and returns; resume() re-enters the
   * same session and fires the same callbacks, so a returning customer
   * settles the order they already approved instead of starting a second.
   */
  /**
   * IS THIS PAGE LOAD A RETURN FROM A REDIRECT?
   *
   * A first visit carries exactly one parameter -- the invoice token. A
   * buyer coming back from a redirect checkout arrives with more, because
   * that is how a redirect flow hands control back. Asking the URL costs
   * nothing and creates nothing.
   *
   * The parameter NAMES are deliberately not hard-coded: they belong to
   * the SDK and inventing a list would be guessing at somebody else's
   * contract. "More than just the token" is the honest test.
   */
  function looksLikeReturn() {
    const params = new URLSearchParams(window.location.search);
    let count = 0;
    params.forEach((value, key) => { if (key !== "t") count += 1; });
    return count > 0;
  }

  function resumeIfReturning(sdk) {
    /**
     * NO SESSION IS CREATED ON AN ORDINARY FIRST LOAD (9 Sep 2026).
     *
     * This used to build a PayPal session on every page load purely to
     * ask it whether the buyer was returning, and then abandon it. That
     * made PayPal the ONLY method for which two sessions existed -- Venmo
     * creates one per click and Google Pay one for the page -- and PayPal
     * was the only method whose window opened and closed immediately on
     * this host.
     *
     * The same code ran on the Apps Script host without visible harm,
     * which is consistent with that page being inside a sandboxed iframe
     * where presentationMode "auto" cannot use a popup and falls back to
     * a modal. A latent fault that one host happened to mask is still a
     * fault, and an abandoned session is wrong on its own terms.
     */
    if (!looksLikeReturn()) return;
    try {
      const session = sdk.createPayPalOneTimePaymentSession(sessionOptions());
      if (session.hasReturned && session.hasReturned()) {
        showStatus("Confirming your payment. Please wait.", "info");
        session.resume();
      }
    } catch (error) {
      /* Nothing to resume is not a problem worth showing anybody. */
    }
  }

  /* ── Boot ────────────────────────────────────────────────────────── */

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
