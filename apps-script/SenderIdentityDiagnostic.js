/**
 * TEMPORARY DIAGNOSTIC — SERVICE SENDER IDENTITY.
 *
 * DELETE THIS FILE AFTER USE. It is not part of Website Intake and nothing
 * calls it. It exists to answer one question with a measurement instead of
 * a screenshot:
 *
 *   Can the account that actually sends the service request emails select
 *   service@cornerpostplumbing.com as a From identity?
 *
 * WHY IT LIVES HERE AND NOT IN THE SERVICE SYSTEM. The email code belongs
 * to the Service System, but a library runs inside the CALLER's execution
 * and under the CALLER's authorization. Website Intake is what a website
 * visitor triggers, so Website Intake is the project whose authorization
 * has to be able to reach Gmail. Running this here measures the thing that
 * matters rather than something adjacent to it.
 *
 * IT SENDS NOTHING. GmailApp.getAliases() is a read. No message is
 * composed, no draft is created, no setting is changed.
 *
 * IT WILL ASK FOR AUTHORIZATION, and that is the second half of the point.
 * Website Intake has never used Gmail: the service request emails were sent
 * with MailApp, which only needs the narrow "send email as you" scope.
 * GmailApp is the only Apps Script API that can select a verified send-as
 * alias, and it requires the full https://mail.google.com/ scope. Granting
 * that is a deliberate architectural consequence of requiring a legitimate
 * From address, not an oversight -- see the report accompanying this file.
 */

/**
 * Reports whether the Service sender identity is available to this project.
 *
 * Run this from the Apps Script editor and read the execution log.
 *
 * @return {Object} The measurement, also written to the log.
 */
function cpDiagnoseServiceSenderIdentityV520() {
  const WANTED = 'service@cornerpostplumbing.com';

  const out = {
    executingUser: '',
    primaryAddress: '',
    aliases: [],
    serviceAliasAvailable: false,
    verdict: ''
  };

  try {
    out.executingUser = Session.getEffectiveUser().getEmail();
  } catch (e) {
    out.executingUser = '(could not read effective user: ' + e.message + ')';
  }

  try {
    /* getAliases() returns the VERIFIED send-as addresses, and deliberately
     * does not include the account's own primary address. An alias appearing
     * here is exactly what GmailApp will accept as a `from` option. */
    out.aliases = GmailApp.getAliases();
  } catch (e) {
    out.verdict = 'FAILED: could not read aliases: ' + e.message;
    Logger.log(cpFormatSenderDiagnosticV520_(out));
    console.error(out.verdict);
    return out;
  }

  /* Compared case-insensitively. Gmail preserves whatever capitalisation was
   * typed when the alias was added, and an address is not case sensitive, so
   * an exact match would be a test of typing rather than of configuration. */
  const wantedLower = WANTED.toLowerCase();
  out.serviceAliasAvailable = out.aliases
    .map(function (a) { return String(a).trim().toLowerCase(); })
    .indexOf(wantedLower) !== -1;

  out.verdict = out.serviceAliasAvailable
    ? 'PASS — ' + WANTED + ' is an authorized send-as identity for this ' +
      'project. Explicit sender selection can proceed.'
    : 'STOP — ' + WANTED + ' is NOT available to this project. Do not code ' +
      'around this. Gmail > Settings > Accounts > Send mail as, on the ' +
      'account shown above.';

  const report = cpFormatSenderDiagnosticV520_(out);
  Logger.log(report);
  console.log(report);
  return out;
}

/** @private */
function cpFormatSenderDiagnosticV520_(out) {
  const lines = [
    '',
    '================ SERVICE SENDER IDENTITY ================',
    'executing user  : ' + out.executingUser,
    'send-as aliases : ' + (out.aliases.length
      ? out.aliases.join(', ')
      : '(none configured)'),
    'service alias   : ' + (out.serviceAliasAvailable ? 'AVAILABLE' : 'NOT AVAILABLE'),
    '',
    out.verdict,
    '========================================================',
    ''
  ];
  return lines.join('\n');
}
