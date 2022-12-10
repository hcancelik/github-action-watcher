const successMessage = "All checks have passed";
const errorMessage = "Some checks were not successful";

chrome.runtime.onMessage.addListener(
  function (request, sender, sendResponse) {
    const { title, status } = request;
    const { id } = sender.tab;

    console.log(status);

    if (status && status.includes(successMessage)) {
      sendResponse("done");

      chrome.notifications.create(title, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("/images/icon-32.png"),
        title: "Ready To Merge",
        message: `PR ${title} is ready to merge`,
        priority: 2,
        requireInteraction: true,
      })

      chrome.notifications.onClicked.addListener(function() {
        chrome.tabs.update(id, { active: true });

        chrome.notifications.clear(title);
      });
    } else if (status && status.includes(errorMessage)) {
      sendResponse("done");

      chrome.notifications.create(title, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("/images/icon-32.png"),
        title: "Action Error",
        message: `One or more of PR ${title} actions failed`,
        priority: 2,
        requireInteraction: true,
      })

      chrome.notifications.onClicked.addListener(function() {
        chrome.tabs.update(id, { active: true });

        chrome.notifications.clear(title);
      });
    } else {
      sendResponse("processing");
    }
  }
);