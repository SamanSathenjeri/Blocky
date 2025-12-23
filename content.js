const originalAssign = location.assign;
const originalReplace = location.replace;

location.assign = function (url) {
  console.log("Redirect blocked:", url);
};

location.replace = function (url) {
  console.log("Redirect blocked:", url);
};

// Block window.open popups
window.open = function () {
  console.log("Popup blocked");
  return null;
};

// Block common redirect tricks
Object.defineProperty(window, "location", {
  writable: false
});

document.addEventListener("click", e => {
  const link = e.target.closest("a");
  if (!link) return;

  if (link.target === "_blank") {
    e.preventDefault();
    console.log("Popup link blocked:", link.href);
  }
}, true);