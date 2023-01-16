function setup() {
  const actions = document.querySelector(".gh-header-actions");
  const btn = document.getElementById("github-pr-watcher-button");

  if (actions && !btn) {
    const button = document.createElement("button");

    button.className = "btn btn-sm";
    button.innerHTML = `<div id="github-pr-watcher-button" style='display: flex; align-items: center'>
      <img alt="Watch Actions" id="github-pr-watcher-icon" src='${chrome.runtime.getURL("/images/icon-32.png")}' height='20' style='padding-right: 5px;' /> Watch Actions
     </div>`;
    button.addEventListener("click", () => {
      chrome.storage.local.set({ [window.location.href]: true });

      const img = document.getElementById("github-pr-watcher-icon");

      img.src = chrome.runtime.getURL("/images/loading.gif");

      const watchInterval = setInterval(() => {
        const message = {
          status: document.getElementById("partial-pull-merging")?.innerText,
          title: document.querySelector(".js-issue-title.markdown-title")?.innerText,
        };

        chrome.runtime.sendMessage(message, function (response) {
          if (response === "processing") {
            img.src = chrome.runtime.getURL("/images/loading.gif");
          } else {
            img.src = chrome.runtime.getURL("/images/icon-32.png");

            clearInterval(watchInterval);

            chrome.storage.local.remove(window.location.href);
          }
        });
      }, 1000);
    });

    const lastChild = actions.lastElementChild.previousElementSibling;

    if (lastChild) {
      actions.insertBefore(button, lastChild);
    }

    chrome.storage.local.get(window.location.href, function (result) {
      if (result[window.location.href]) {
        button.click();
      }
    });
  }
}

setup();

var observer = new MutationObserver(function() {
  setup();
});

observer.observe(document.querySelector('.new-discussion-timeline'), {
  attributes: false,
  characterData: false,
  childList: true,
  subtree: true
});
