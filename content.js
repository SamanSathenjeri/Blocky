(() => {
  "use strict";

  const USER_GESTURE_TIMEOUT = 2000; // Increased timeout for better UX
  const HREF_POLL_INTERVAL = 200; // Reduced polling frequency
  const REDIRECT_BLOCK_DELAY = 100; // Delay before blocking redirects

  let isEnabled = true;
  let lastUserGesture = 0;
  let lastHref = location.href;
  let redirectBlockTimer = null;
  let isNavigating = false;
  let allowedRedirects = new Set(); // Track allowed redirects

  // Load initial enabled state from storage
  chrome.storage.local
    .get("blockyEnabled")
    .then((res) => {
      isEnabled = res.blockyEnabled ?? true; // Update outer variable, not create new one
      console.log("[Blocky] Enabled status:", isEnabled);
    })
    .catch((err) => {
      console.error("[Blocky] Error loading enabled state:", err);
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
    try {
      chrome.runtime.sendMessage({ type: "userGesture" }).catch(() => {
        // Ignore errors if background script is not ready
      });
    } catch (err) {
      // Ignore errors
    }
  };

  const hasRecentGesture = () =>
    Date.now() - lastUserGesture < USER_GESTURE_TIMEOUT;

  // Track user interactions
  ["click", "mousedown", "keydown", "touchstart"].forEach((evt) => {
    document.addEventListener(evt, markGesture, true);
  });

  // Track form submissions as user gestures (legitimate navigation)
  document.addEventListener(
    "submit",
    (e) => {
      markGesture();
      isNavigating = true;
      // Allow navigation after form submission
      setTimeout(() => {
        isNavigating = false;
      }, 3000);
    },
    true
  );

  // Override window.open
  const realOpen = window.open;
  window.open = function (url, target, features) {
    if (!isEnabled) return realOpen.call(window, url, target, features);
    if (!hasRecentGesture()) {
      console.warn("[Blocky] Popup blocked:", url);
      return null;
    }
    return realOpen.call(window, url, target, features);
  };

  // Click interception - only block suspicious popup links
  document.addEventListener(
    "click",
    (e) => {
      if (!isEnabled) return;
      const link = e.target.closest("a");
      if (!link || !link.href) return;

      // Only block if:
      // 1. It's a target="_blank" link
      // 2. No recent user gesture
      // 3. The link doesn't look legitimate (not a same-origin link or common patterns)
      if (link.target === "_blank" && !hasRecentGesture()) {
        const linkUrl = new URL(link.href, location.origin);
        const currentUrl = new URL(location.href);

        // Allow same-origin links and common legitimate patterns
        const isSameOrigin = linkUrl.origin === currentUrl.origin;
        const isLegitimatePattern =
          linkUrl.hostname.includes(currentUrl.hostname) ||
          /^(https?:\/\/)?(www\.)?(github|stackoverflow|wikipedia|youtube|reddit|twitter|x\.com)/i.test(
            linkUrl.hostname
          );

        if (!isSameOrigin && !isLegitimatePattern) {
          console.warn("[Blocky] Suspicious popup link blocked:", link.href);
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          return false;
        }
      }
    },
    true
  );

  // Improved forced redirect detection - only block suspicious redirects
  const checkForRedirect = () => {
    if (!isEnabled || isNavigating) return;

    const currentHref = location.href;
    if (currentHref === lastHref) return;

    // Check if this redirect was allowed
    if (allowedRedirects.has(currentHref)) {
      allowedRedirects.delete(currentHref);
      lastHref = currentHref;
      return;
    }

    // Allow redirects that happen shortly after user gesture (legitimate navigation)
    if (hasRecentGesture()) {
      allowedRedirects.add(currentHref);
      lastHref = currentHref;
      return;
    }

    // Check if redirect looks suspicious
    try {
      const currentUrl = new URL(currentHref);
      const lastUrl = new URL(lastHref);

      // Allow same-origin redirects (likely legitimate)
      if (currentUrl.origin === lastUrl.origin) {
        lastHref = currentHref;
        return;
      }

      // Check for suspicious patterns
      const suspiciousPatterns = [
        /redirect|track|affiliate|click|ad|popup|popunder/i,
        /[?&](utm_|ref=|source=|campaign=)/i,
        currentUrl.search.length > 200, // Very long query strings often indicate tracking
      ];

      const isSuspicious = suspiciousPatterns.some((pattern) =>
        typeof pattern === "boolean" ? pattern : pattern.test(currentHref)
      );

      if (isSuspicious) {
        console.warn(
          "[Blocky] Suspicious redirect detected:",
          lastHref,
          "→",
          currentHref
        );
        // Clear any pending redirect block
        if (redirectBlockTimer) {
          clearTimeout(redirectBlockTimer);
        }
        // Block after a short delay to allow legitimate redirects
        redirectBlockTimer = setTimeout(() => {
          try {
            history.back();
          } catch (err) {
            console.error("[Blocky] Error blocking redirect:", err);
          }
        }, REDIRECT_BLOCK_DELAY);
      } else {
        // Legitimate redirect, update lastHref
        lastHref = currentHref;
      }
    } catch (err) {
      // Invalid URL, just update lastHref
      lastHref = currentHref;
    }
  };

  // Poll for redirects with reduced frequency
  setInterval(checkForRedirect, HREF_POLL_INTERVAL);

  // Also listen to popstate for browser navigation
  window.addEventListener(
    "popstate",
    () => {
      lastHref = location.href;
      if (redirectBlockTimer) {
        clearTimeout(redirectBlockTimer);
        redirectBlockTimer = null;
      }
    },
    true
  );

  // Iframe protection - improved with better error handling
  const observer = new MutationObserver((mutations) => {
    if (!isEnabled) return;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "IFRAME") {
          try {
            // Use setTimeout to allow iframe to load
            setTimeout(() => {
              try {
                const win = node.contentWindow;
                if (!win) return;
                const iframeOpen = win.open;
                if (typeof iframeOpen === "function") {
                  win.open = function () {
                    if (!isEnabled) return iframeOpen.apply(win, arguments);
                    if (!hasRecentGesture()) {
                      console.warn("[Blocky] Iframe popup blocked");
                      return null;
                    }
                    return iframeOpen.apply(win, arguments);
                  };
                }
              } catch (err) {
                // CORS error - expected for cross-origin iframes, ignore
              }
            }, 100);
          } catch (err) {
            // Ignore errors
          }
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Meta refresh blocking - only block suspicious meta refreshes
  const metaObserver = new MutationObserver(() => {
    if (!isEnabled) return;
    document.querySelectorAll('meta[http-equiv="refresh"]').forEach((meta) => {
      const content = meta.getAttribute("content");
      if (!content) return;

      // Parse refresh delay
      const match = content.match(/^\s*(\d+)/);
      const delay = match ? parseInt(match[1], 10) : 0;

      // Only block immediate or very short refreshes without user gesture
      // Allow longer delays (likely legitimate redirects)
      if (delay < 2 && !hasRecentGesture()) {
        console.warn("[Blocky] Suspicious meta refresh blocked");
        meta.remove();
      }
    });
  });

  metaObserver.observe(document.head || document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Blur / popunder detection - only log, don't block
  window.addEventListener(
    "blur",
    () => {
      if (!isEnabled) return;
      if (!hasRecentGesture()) {
        console.warn(
          "[Blocky] Suspicious blur event detected (monitoring only)"
        );
      }
    },
    true
  );

  // Cleanup on page unload
  window.addEventListener("beforeunload", () => {
    if (redirectBlockTimer) {
      clearTimeout(redirectBlockTimer);
    }
    observer.disconnect();
    metaObserver.disconnect();
  });
})();
