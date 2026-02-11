const successMessage = "All checks have passed";
const errorMessage = "Some checks were not successful";
const noSetupMessage = "Continuous integration has not been set up";

// --- Navigation Listener (Kept from your code) ---
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  chrome.scripting.executeScript({
    target: { tabId: details.tabId, allFrames: true },
    files: ["scripts/content.js"],
  });
});

// --- Global State for Notification Clicks ---
const notificationMap = {};

// --- Click Listener (Defined ONCE at top level) ---
chrome.notifications.onClicked.addListener((notificationId) => {
  const target = notificationMap[notificationId];

  if (target) {
    // 1. Focus the window (fixes issue if Chrome is in background)
    chrome.windows.update(target.windowId, { focused: true }, () => {
      if (chrome.runtime.lastError) return;
    });

    // 2. Activate the tab
    chrome.tabs.update(target.tabId, { active: true }, () => {
      if (chrome.runtime.lastError) return;
    });

    // 3. Cleanup
    chrome.notifications.clear(notificationId);
    delete notificationMap[notificationId];
  }
});

// --- Message Handler ---
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  const { title, status } = request;

  // Safety check
  if (!sender.tab) return;
  const { id: tabId, windowId } = sender.tab;

  if (status && status.includes(successMessage)) {
    sendResponse("done");

    // Map the PR title (notificationId) to this specific tab/window
    notificationMap[title] = { tabId, windowId };

    chrome.notifications.create(title, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("/images/icon-32.png"),
      title: "Ready To Merge",
      message: `PR ${title} is ready to merge`,
      priority: 2,
      requireInteraction: true,
    });
  } else if (status && status.includes(errorMessage)) {
    sendResponse("done");

    notificationMap[title] = { tabId, windowId };

    chrome.notifications.create(title, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("/images/icon-32.png"),
      title: "Action Error",
      message: `One or more of PR ${title} actions failed`,
      priority: 2,
      requireInteraction: true,
    });
  } else if (status && status.includes(noSetupMessage)) {
    sendResponse("done");
  } else {
    sendResponse("processing");
  }
});
