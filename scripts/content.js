const actions = document.querySelector(".gh-header-actions");

if (actions) {
  const button = document.createElement("button");

  button.className = "btn btn-sm";
  button.innerHTML = `<div style='display: flex; align-items: center'>
      <img id="github-pr-watcher-icon" src='${chrome.runtime.getURL("/images/icon-32.png")}' height='20' style='padding-right: 5px;' /> Watch Actions
     </div>`;
  button.addEventListener("click", () => {
    console.info("Starting to watch actions");

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
        }
      });
    }, 1000);
  });

  const lastChild = actions.lastElementChild;

  if (lastChild) {
    actions.insertBefore(button, lastChild);
  }
}
