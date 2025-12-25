const toggleBtn = document.getElementById("toggleBtn");
const statusIcon = document.getElementById("statusIcon");

chrome.storage.local.get("blockyEnabled", (res) => {
  const enabled = res.blockyEnabled ?? true;
  statusIcon.src = enabled ? "/images/on.jpg" : "/images/off.jpg";
  statusText.innerText =  enabled ? "Protection is ON" : "Protection is OFF";
});

toggleBtn.addEventListener("click", () => {
  chrome.storage.local.get("blockyEnabled", (res) => {
    const enabled = !(res.blockyEnabled ?? true);
    chrome.storage.local.set({ blockyEnabled: enabled });
    statusIcon.src = enabled ? "/images/on.jpg" : "/images/off.jpg";
    statusText.innerText =  enabled ? "Protection is ON" : "Protection is OFF";
  });
});
