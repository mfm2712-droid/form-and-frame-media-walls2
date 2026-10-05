export function isIOSDevice({ userAgent = "", platform = "", maxTouchPoints = 0 } = {}) {
  return /iPhone|iPad|iPod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function isInstalledPWA({ displayModeStandalone = false, navigatorStandalone = false } = {}) {
  return displayModeStandalone || navigatorStandalone;
}

export function pushSetupMessage({ ios = false, installed = false, secure = true, configured = false, supported = true } = {}) {
  if (ios && !installed) {
    return "For iPhone or iPad alerts, open this staff app in Safari, tap Share → Add to Home Screen, then open it from the new icon. Web Push requires iOS or iPadOS 16.4 or later. Alerts will be available after the push service is configured.";
  }
  if (!secure) return "Push alerts need the staff app to be open on its secure HTTPS address.";
  if (!supported) return "This browser does not support push notifications. Use a supported, up-to-date browser on the staff app.";
  if (!configured) return "Push alerts are not configured yet. The private delivery service and its server-side keys must be activated first.";
  return "";
}
