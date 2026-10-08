/**
 * Should settle-test.cjs run the permissionless Pyth pull settle (ops-cli pull-settle)? Pure, so the
 * skip/warn copy is unit-tested (apps/automation/test/ops-staging-nits.test.ts). Reviewer nit: a missing
 * settler key used to skip silently; every missing input is now named, and a missing settler.json warns.
 * Secrets by name only: the Hermes key is reported as set/unset, never its value.
 */
function pullSettlePlan({ hermesKeySet, automationDist, opsCliExists, settlerKeyPath, settlerKeyExists }) {
  const reasons = [];
  if (!hermesKeySet) reasons.push("PYTH_HERMES_API_KEY unset");
  if (!automationDist) reasons.push("AUTOMATION_DIST unset");
  else if (!opsCliExists) reasons.push(`ops-cli.js not built in ${automationDist}`);
  const settlerMissing = `settler.json (settler key) missing at ${settlerKeyPath}`;
  if (!settlerKeyExists) reasons.push(settlerMissing);
  const warnings = settlerKeyExists
    ? []
    : [`WARNING ${settlerMissing} — Pyth pull settle skipped; permissionless settle falls back to the authority (keeper)`];
  return {
    run: reasons.length === 0,
    reasons,
    skipLine: reasons.length ? `pull settle skipped: ${reasons.join("; ")} — legacy settle / admin_settle fallback` : null,
    warnings,
  };
}
module.exports = { pullSettlePlan };
