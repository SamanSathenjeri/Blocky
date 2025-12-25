let redirectsThisGesture = 0;

// Detect suspicious redirect hubs
function looksLikeRedirectHub(url) {
  try {
    const u = new URL(url);
    return (
      u.search.length > 300 &&
      /screen|browser|timezone|gpu|canvas|wasm|js_build|fingerprint/i.test(u.search)
    );
  } catch {
    return false;
  }
}

// Listen for navigation events
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0 || details.url.startsWith("chrome")) return;

  // Only block if extension is enabled
  const res = await chrome.storage.local.get("blockyEnabled");
  const isEnabled = res.blockyEnabled ?? true;
  if (!isEnabled) return;

  const q = details.transitionQualifiers || [];
  const isServerRedirect = q.includes("server_redirect");

  // Generic server redirects
  if (isServerRedirect) {
    redirectsThisGesture++;
    if (redirectsThisGesture > 1) {
      console.warn("[Blocky] Redirect chain blocked:", details.url);
      chrome.tabs.goBack(details.tabId);
    } else {
      console.warn("[Blocky] Server redirect blocked:", details.url);
      chrome.tabs.goBack(details.tabId);
    }
  }

  // Redirect hubs (like chaipoksore etc.)
  if (looksLikeRedirectHub(details.url)) {
    console.warn("[Blocky] Redirect hub detected:", details.url);
    chrome.tabs.goBack(details.tabId);
  }
});

// Reset redirect counter on user gestures
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "userGesture") {
    redirectsThisGesture = 0;
  }
});
