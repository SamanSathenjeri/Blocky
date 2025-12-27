const toggleBtn = document.getElementById("toggleBtn");
const statusIcon = document.getElementById("statusIcon");
const statusText = document.getElementById("statusText");

// Initialize UI state
chrome.storage.local.get("blockyEnabled", (res) => {
  const enabled = res.blockyEnabled ?? true;
  if (statusIcon) {
    statusIcon.src = enabled ? "/images/on.jpg" : "/images/off.jpg";
  }
  if (statusText) {
    statusText.innerText = enabled ? "Protection is ON" : "Protection is OFF";
  }
});

// Toggle functionality
toggleBtn?.addEventListener("click", () => {
  chrome.storage.local.get("blockyEnabled", (res) => {
    const enabled = !(res.blockyEnabled ?? true);
    chrome.storage.local.set({ blockyEnabled: enabled }, () => {
      if (statusIcon) {
        statusIcon.src = enabled ? "/images/on.jpg" : "/images/off.jpg";
      }
      if (statusText) {
        statusText.innerText = enabled ? "Protection is ON" : "Protection is OFF";
      }
    });
  });
});
