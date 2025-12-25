(() => {
  "use strict";

  const USER_GESTURE_TIMEOUT = 800; 
  const HREF_POLL_INTERVAL = 100;

  let isEnabled = true;
  let lastUserGesture = 0;

  // Load initial enabled state from storage
  chrome.storage.local.get("blockyEnabled", (res) => {
    isEnabled = res.blockyEnabled ?? true;
    console.log("[Blocky] Enabled status:", isEnabled);
  });

  // Listen for toggle changes from popup or background
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.blockyEnabled) {
      isEnabled = changes.blockyEnabled.newValue;
      console.log("[Blocky] Enabled changed:", isEnabled);
    }
  });

  // Track user gestures
  const markGesture = () => {
    lastUserGesture = Date.now();
    chrome.runtime.sendMessage({ type: "userGesture" });
  };

  const hasRecentGesture = () => Date.now() - lastUserGesture < USER_GESTURE_TIMEOUT;

  ["click", "mousedown", "keydown", "touchstart"].forEach(evt => {
    document.addEventListener(evt, markGesture, true);
  });

  // Override window.open
  const realOpen = window.open;
  window.open = function(url, target, features) {
    if (!isEnabled) return realOpen.call(window, url, target, features);
    if (!hasRecentGesture()) {
      console.warn("[Blocky] Popup blocked:", url);
      return null;
    }
    return realOpen.call(window, url, target, features);
  };

  // Click interception
  document.addEventListener("click", e => {
    if (!isEnabled) return;
    const link = e.target.closest("a");
    if (!link) return;

    if (link.target === "_blank" && !hasRecentGesture()) {
      console.warn("[Blocky] Popup link blocked:", link.href);
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // Forced redirect detection
  let lastHref = location.href;
  setInterval(() => {
    if (!isEnabled) return;
    if (location.href !== lastHref) {
      if (!hasRecentGesture()) {
        console.warn("[Blocky] Forced redirect detected:", lastHref, "→", location.href);
        history.back();
      }
      lastHref = location.href;
    }
  }, HREF_POLL_INTERVAL);

  // Iframe protection
  const observer = new MutationObserver(mutations => {
    if (!isEnabled) return;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.tagName === "IFRAME") {
          try {
            const win = node.contentWindow;
            if (!win) continue;
            const iframeOpen = win.open;
            win.open = function() {
              if (!hasRecentGesture()) {
                console.warn("[Blocky] Iframe popup blocked");
                return null;
              }
              return iframeOpen.apply(win, arguments);
            };
          } catch {}
        }
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Meta refresh blocking
  const metaObserver = new MutationObserver(() => {
    if (!isEnabled) return;
    document.querySelectorAll('meta[http-equiv="refresh"]').forEach(meta => {
      if (!hasRecentGesture()) {
        console.warn("[Blocky] Meta refresh blocked");
        meta.remove();
      }
    });
  });

  metaObserver.observe(document.head || document.documentElement, { childList: true, subtree: true });

  // Blur / popunder detection
  window.addEventListener("blur", () => {
    if (!isEnabled) return;
    if (!hasRecentGesture()) console.warn("[Blocky] Suspicious blur event");
  });

})();
