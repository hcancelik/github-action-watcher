const DOM_SUCCESS = [
  "All checks have passed",
  "All checks were successful",
];
const DOM_ERROR = [
  "Some checks were not successful",
  "All checks have failed",
];
const DOM_NO_SETUP = ["Continuous integration has not been set up"];

const notificationMap = {};
const apiCache = new Map();
const API_POLL_MS = 15000;

function safeSendResponse(sendResponse, value) {
  try {
    sendResponse(value);
  } catch {
    // Receiver tab/frame is gone.
  }
}

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!details.url?.includes("github.com") || !details.url.includes("/pull/")) {
    return;
  }

  chrome.scripting
    .executeScript({
      target: { tabId: details.tabId, frameIds: [0] },
      func: () => Boolean(window.__githubPrWatcherState?.runSetup),
    })
    .then((results) => {
      const alreadyRunning = Boolean(results?.[0]?.result);
      if (alreadyRunning) {
        return chrome.scripting.executeScript({
          target: { tabId: details.tabId, frameIds: [0] },
          func: () => {
            try {
              window.__githubPrWatcherState?.runSetup?.();
            } catch {
              // ignore
            }
          },
        });
      }

      return chrome.scripting.executeScript({
        target: { tabId: details.tabId, frameIds: [0] },
        files: ["scripts/content.js"],
      });
    })
    .catch(() => {});
});

chrome.notifications.onClicked.addListener((notificationId) => {
  const target = notificationMap[notificationId];

  if (target) {
    chrome.windows.update(target.windowId, { focused: true }, () => {
      void chrome.runtime.lastError;
    });

    chrome.tabs.update(target.tabId, { active: true }, () => {
      void chrome.runtime.lastError;
    });

    chrome.notifications.clear(notificationId, () => {
      void chrome.runtime.lastError;
    });
    delete notificationMap[notificationId];
  }
});

function countInStatus(status, pattern) {
  const match = status.match(pattern);
  return match ? Number(match[1]) : 0;
}

function hasFailingChecks(status) {
  return (
    /all checks have failed/i.test(status) ||
    /\b\d+\s+failing\b/i.test(status) ||
    /\bfailing checks?\b/i.test(status) ||
    /some checks were not successful/i.test(status)
  );
}

function hasIncompleteChecks(status) {
  return (
    /haven['’]?t completed yet/i.test(status) ||
    /\bpending checks?\b/i.test(status) ||
    /\b\d+\s+pending checks?\b/i.test(status) ||
    /\bin progress\b/i.test(status) ||
    (/\bexpected\b/i.test(status) && /\bchecks?\b/i.test(status))
  );
}

function classifyDomStatus(status) {
  if (!status || status === "N/A") return null;

  for (const message of DOM_ERROR) {
    if (status.includes(message)) return "error";
  }

  if (hasFailingChecks(status)) return "error";

  // Explicit success first. GitHub shows this even when some checks are skipped:
  // "All checks have passed" / "1 skipped, 18 successful checks"
  for (const message of DOM_SUCCESS) {
    if (status.includes(message)) return "success";
  }

  if (hasIncompleteChecks(status)) return "processing";

  const ofMatch = status.match(/(\d+)\s+of\s+(\d+)\s+checks?\s+passed/i);
  if (ofMatch) {
    const passed = Number(ofMatch[1]);
    const total = Number(ofMatch[2]);
    const skipped = countInStatus(status, /(\d+)\s+skipped\b/i);
    if (passed + skipped >= total) return "success";
    return "processing";
  }

  const passedOnly = countInStatus(status, /(\d+)\s+checks?\s+passed\b/i);
  const successfulOnly = countInStatus(
    status,
    /(\d+)\s+successful checks?\b/i,
  );
  const skippedOnly = countInStatus(status, /(\d+)\s+skipped\b/i);

  if (
    (passedOnly > 0 || successfulOnly > 0 || skippedOnly > 0) &&
    !hasFailingChecks(status) &&
    !hasIncompleteChecks(status)
  ) {
    return "success";
  }

  if (
    /\bskipped\b/i.test(status) &&
    /\bsuccessful\b/i.test(status) &&
    !hasFailingChecks(status) &&
    !hasIncompleteChecks(status)
  ) {
    return "success";
  }

  for (const message of DOM_NO_SETUP) {
    if (status.includes(message)) return "no_setup";
  }

  if (/no checks? (have been )?(added|set up)/i.test(status)) return "no_setup";

  return null;
}

function classifyCheckRuns(checkRuns) {
  if (!checkRuns.length) return "no_setup";

  const incomplete = checkRuns.some((run) => run.status !== "completed");
  if (incomplete) return "processing";

  const failed = checkRuns.some((run) =>
    [
      "failure",
      "timed_out",
      "cancelled",
      "action_required",
      "startup_failure",
    ].includes(run.conclusion),
  );
  if (failed) return "error";

  return "success";
}

async function fetchCheckStatusFromApi(pr) {
  if (!pr?.owner || !pr?.repo || !pr?.number) return null;

  const key = `${pr.owner}/${pr.repo}/${pr.number}`;
  const cached = apiCache.get(key);
  const now = Date.now();

  if (cached && now - cached.at < API_POLL_MS) {
    return cached.result;
  }

  try {
    const prResponse = await fetch(
      `https://api.github.com/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!prResponse.ok) {
      apiCache.set(key, { at: now, result: null });
      return null;
    }

    const pull = await prResponse.json();
    const sha = pull.head?.sha;
    if (!sha) {
      apiCache.set(key, { at: now, result: null });
      return null;
    }

    const checksResponse = await fetch(
      `https://api.github.com/repos/${pr.owner}/${pr.repo}/commits/${sha}/check-runs?per_page=100`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!checksResponse.ok) {
      apiCache.set(key, { at: now, result: null });
      return null;
    }

    const data = await checksResponse.json();
    const result = classifyCheckRuns(data.check_runs || []);
    apiCache.set(key, { at: now, result });
    return result;
  } catch {
    apiCache.set(key, { at: now, result: null });
    return null;
  }
}

function notify(result, title, tabId, windowId) {
  notificationMap[title] = { tabId, windowId };

  const iconUrl = chrome.runtime.getURL("/images/icon-32.png");

  if (result === "success") {
    chrome.notifications.create(
      title,
      {
        type: "basic",
        iconUrl,
        title: "Ready To Merge",
        message: `PR ${title} is ready to merge`,
        priority: 2,
        requireInteraction: true,
      },
      () => {
        void chrome.runtime.lastError;
      },
    );
    return;
  }

  if (result === "error") {
    chrome.notifications.create(
      title,
      {
        type: "basic",
        iconUrl,
        title: "Action Error",
        message: `One or more of PR ${title} actions failed`,
        priority: 2,
        requireInteraction: true,
      },
      () => {
        void chrome.runtime.lastError;
      },
    );
  }
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  const { title, status, pr } = request;

  if (!sender.tab) return false;
  const { id: tabId, windowId } = sender.tab;
  const prTitle = title || "PR";

  (async () => {
    try {
      let result = classifyDomStatus(status);

      if (result === null || result === "processing") {
        const apiResult = await fetchCheckStatusFromApi(pr);
        if (
          apiResult === "success" ||
          apiResult === "error" ||
          apiResult === "no_setup"
        ) {
          result = apiResult;
        } else if (apiResult === "processing") {
          result = "processing";
        }
      }

      if (result === "success" || result === "error") {
        notify(result, prTitle, tabId, windowId);
        safeSendResponse(sendResponse, "done");
        return;
      }

      if (result === "no_setup") {
        safeSendResponse(sendResponse, "done");
        return;
      }

      safeSendResponse(sendResponse, "processing");
    } catch {
      safeSendResponse(sendResponse, "processing");
    }
  })();

  return true;
});
