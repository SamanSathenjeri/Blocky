// Track redirects per tab
const tabRedirects = new Map();
const tabUserGestures = new Map();
const USER_GESTURE_TIMEOUT = 3000; // 3 seconds
const MAX_ALLOWED_REDIRECTS = 2; // Allow up to 2 redirects in a chain

// Detect suspicious redirect hubs
function looksLikeRedirectHub(url) {
  try {
    const u = new URL(url);
    // Check for suspicious patterns:
    // 1. Very long query strings with fingerprinting parameters
    // 2. Known redirect hub domains
    const suspiciousQuery = u.search.length > 300 &&
      /screen|browser|timezone|gpu|canvas|wasm|js_build|fingerprint/i.test(u.search);
    
    // Known redirect hub patterns
    const suspiciousDomains = [
      /chaipoksore/i,
      /redirect/i,
      /track/i,
      /click/i
    ];
    
    const suspiciousDomain = suspiciousDomains.some(pattern => pattern.test(u.hostname));
    
    return suspiciousQuery || (suspiciousDomain && u.search.length > 100);
  } catch {
    return false;
  }
}

// Check if redirect looks legitimate
function isLegitimateRedirect(url, referrer) {
  try {
    const u = new URL(url);
    const ref = referrer ? new URL(referrer) : null;
    
    // Same-origin redirects are usually legitimate
    if (ref && u.origin === ref.origin) {
      return true;
    }
    
    // Common legitimate redirect patterns
    const legitimatePatterns = [
      /oauth|auth|login|logout|callback|return/i, // OAuth flows
      /checkout|payment|paypal|stripe/i, // Payment flows
      /verify|confirm|validate/i, // Verification flows
      /github\.com|google\.com|microsoft\.com|apple\.com/i // Major services
    ];
    
    return legitimatePatterns.some(pattern => pattern.test(url));
  } catch {
    return false;
  }
}

// Listen for navigation events
chrome.webNavigation.onCommitted.addListener(async (details) => {
  // Only process main frame navigations
  if (details.frameId !== 0 || details.url.startsWith("chrome") || details.url.startsWith("edge")) {
    return;
  }

  // Only block if extension is enabled
  let isEnabled = true;
  try {
    const res = await chrome.storage.local.get("blockyEnabled");
    isEnabled = res.blockyEnabled ?? true;
  } catch (err) {
    console.error("[Blocky] Error reading enabled state:", err);
    return;
  }

  if (!isEnabled) return;

  const tabId = details.tabId;
  const q = details.transitionQualifiers || [];
  const isServerRedirect = q.includes("server_redirect");
  const transitionType = details.transitionType;

  // Track user gestures per tab
  const lastGesture = tabUserGestures.get(tabId) || 0;
  const hasRecentGesture = Date.now() - lastGesture < USER_GESTURE_TIMEOUT;

  // Initialize redirect tracking for this tab
  if (!tabRedirects.has(tabId)) {
    tabRedirects.set(tabId, {
      count: 0,
      lastReset: Date.now()
    });
  }

  const redirectInfo = tabRedirects.get(tabId);

  // Reset redirect count if enough time has passed or user gesture occurred
  if (Date.now() - redirectInfo.lastReset > 5000 || hasRecentGesture) {
    redirectInfo.count = 0;
    redirectInfo.lastReset = Date.now();
  }

  // Check for suspicious redirect hubs first (highest priority)
  if (looksLikeRedirectHub(details.url)) {
    console.warn("[Blocky] Redirect hub detected:", details.url);
    try {
      await chrome.tabs.goBack(tabId);
    } catch (err) {
      console.error("[Blocky] Error going back:", err);
    }
    return;
  }

  // Handle server redirects more intelligently
  if (isServerRedirect) {
    // Check if this looks like a legitimate redirect
    if (isLegitimateRedirect(details.url, details.url)) {
      // Allow legitimate redirects
      redirectInfo.count = 0;
      return;
    }

    redirectInfo.count++;

    // Only block if:
    // 1. Multiple redirects in short succession (redirect chain)
    // 2. No recent user gesture
    // 3. Doesn't look legitimate
    if (redirectInfo.count > MAX_ALLOWED_REDIRECTS && !hasRecentGesture) {
      console.warn("[Blocky] Redirect chain blocked:", details.url, `(${redirectInfo.count} redirects)`);
      try {
        await chrome.tabs.goBack(tabId);
        redirectInfo.count = 0; // Reset after blocking
      } catch (err) {
        console.error("[Blocky] Error blocking redirect:", err);
      }
    } else if (redirectInfo.count === 1 && !hasRecentGesture) {
      // Single redirect without gesture - log but don't block (too aggressive)
      console.log("[Blocky] Server redirect detected (monitoring):", details.url);
    }
  } else {
    // Not a server redirect, reset counter
    redirectInfo.count = 0;
  }
});

// Reset redirect counter on user gestures
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "userGesture") {
    const tabId = sender?.tab?.id;
    if (tabId) {
      tabUserGestures.set(tabId, Date.now());
      // Reset redirect count for this tab
      if (tabRedirects.has(tabId)) {
        tabRedirects.get(tabId).count = 0;
        tabRedirects.get(tabId).lastReset = Date.now();
      }
    }
  }
});

// Clean up tab data when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabRedirects.delete(tabId);
  tabUserGestures.delete(tabId);
});

// Clean up old tab data periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 60000; // 1 minute

  for (const [tabId, gestureTime] of tabUserGestures.entries()) {
    if (now - gestureTime > maxAge) {
      tabUserGestures.delete(tabId);
    }
  }

  for (const [tabId, redirectInfo] of tabRedirects.entries()) {
    if (now - redirectInfo.lastReset > maxAge) {
      tabRedirects.delete(tabId);
    }
  }
}, 30000); // Clean up every 30 seconds
