(function () {
  // Re-entry after SPA inject: reuse shared state, replace handlers.
  const state = (window.__githubPrWatcherState = window.__githubPrWatcherState || {
    dead: false,
    watchIntervalId: null,
    observer: null,
    timeoutForObserver: null,
    iconUrl: null,
    loadingUrl: null,
    runSetup: null,
  });

  function markDead() {
    if (state.dead) return;
    state.dead = true;

    if (state.watchIntervalId != null) {
      clearInterval(state.watchIntervalId);
      state.watchIntervalId = null;
    }
    if (state.timeoutForObserver != null) {
      clearTimeout(state.timeoutForObserver);
      state.timeoutForObserver = null;
    }
    if (state.observer) {
      try {
        state.observer.disconnect();
      } catch {
        // ignore
      }
      state.observer = null;
    }
    state.runSetup = null;

    try {
      document.getElementById("github-pr-watcher-button")?.remove();
      document.getElementById("github-pr-watcher-actions")?.remove();
    } catch {
      // ignore
    }
  }

  function isAlive() {
    if (state.dead) return false;
    try {
      // Accessing runtime after reload throws "Extension context invalidated".
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch {
      markDead();
      return false;
    }
  }

  function initResourceUrls() {
    if (state.iconUrl && state.loadingUrl) return true;
    if (!isAlive()) return false;
    try {
      state.iconUrl = chrome.runtime.getURL("/images/icon-32.png");
      state.loadingUrl = chrome.runtime.getURL("/images/loading.gif");
      return true;
    } catch {
      markDead();
      return false;
    }
  }

  function parsePrFromUrl(url = window.location.href) {
    const match = url.match(
      /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
    );
    if (!match) return null;
    return { owner: match[1], repo: match[2], number: Number(match[3]) };
  }

  function getPrTitle() {
    return (
      document
        .querySelector('[data-component="PH_Title"] .markdown-title')
        ?.textContent?.trim() ||
      document.querySelector('[data-testid="issue-title"]')?.textContent?.trim() ||
      document
        .querySelector(".js-issue-title.markdown-title")
        ?.textContent?.trim() ||
      document.title.split("·")[0]?.trim() ||
      "PR"
    );
  }

  const CHECK_STATUS_PATTERN =
    /all checks have passed|all checks were successful|some checks were not successful|all checks have failed|some checks haven['’]?t completed|continuous integration has not been set up|\d+\s+of\s+\d+\s+checks?\s+passed|\d+\s+successful checks?|\d+\s+skipped/i;

  function getChecksStatusText() {
    const containers = [
      document.querySelector('section[aria-label="Checks"]'),
      document.querySelector('[data-testid="mergebox-partial"]'),
      document.getElementById("partial-pull-merging"),
      document.querySelector('[class*="MergeBox"]'),
    ].filter(Boolean);

    for (const container of containers) {
      const text = container.innerText?.trim();
      if (text && CHECK_STATUS_PATTERN.test(text)) {
        return text;
      }
    }

    const headings = document.querySelectorAll(
      'h1, h2, h3, h4, [class*="MergeBoxSectionHeader"], [class*="merge-status"]',
    );
    for (const heading of headings) {
      const text = heading.textContent?.trim() || "";
      if (!CHECK_STATUS_PATTERN.test(text) && !/checks?/i.test(text)) {
        continue;
      }
      const scope =
        heading.closest("section") ||
        heading.closest('[class*="MergeBox"]') ||
        heading.parentElement;
      const scopeText = scope?.innerText?.trim();
      if (scopeText && CHECK_STATUS_PATTERN.test(scopeText)) {
        return scopeText;
      }
      if (CHECK_STATUS_PATTERN.test(text)) {
        return text;
      }
    }

    for (const container of containers) {
      const text = container.innerText?.trim();
      if (text) return text;
    }

    return "N/A";
  }

  function getActionsContainer() {
    const classic = document.querySelector(".gh-header-actions");
    if (classic) return classic;

    const phActions = document.querySelector('[data-component="PH_Actions"]');
    if (phActions) {
      phActions.classList.remove("d-none");
      return phActions;
    }

    const title =
      document.querySelector('[data-component="PH_Title"]') ||
      document.querySelector(".gh-header-title");
    if (!title?.parentElement) return null;

    let fallback = document.getElementById("github-pr-watcher-actions");
    if (!fallback) {
      fallback = document.createElement("div");
      fallback.id = "github-pr-watcher-actions";
      fallback.style.cssText =
        "display: inline-flex; align-items: center; gap: 8px; margin-left: 8px;";
      title.parentElement.appendChild(fallback);
    }
    return fallback;
  }

  function createWatchButton() {
    if (!initResourceUrls()) return null;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "github-pr-watcher-button";
    button.setAttribute("data-view-component", "true");
    button.className = "Button--secondary Button--medium Button";

    const content = document.createElement("span");
    content.className = "Button-content";

    const visual = document.createElement("span");
    visual.className = "Button-visual Button-leadingVisual";

    const img = document.createElement("img");
    img.alt = "";
    img.id = "github-pr-watcher-icon";
    img.width = 16;
    img.height = 16;
    img.style.display = "block";
    img.src = state.iconUrl;

    const label = document.createElement("span");
    label.className = "Button-label";
    label.textContent = "Watch Actions";

    visual.appendChild(img);
    content.appendChild(visual);
    content.appendChild(label);
    button.appendChild(content);
    return button;
  }

  function setIcon(kind) {
    const icon = document.getElementById("github-pr-watcher-icon");
    if (!icon) return false;
    const url = kind === "loading" ? state.loadingUrl : state.iconUrl;
    if (!url) {
      markDead();
      return false;
    }
    try {
      icon.src = url;
      return true;
    } catch {
      markDead();
      return false;
    }
  }

  function stopWatching() {
    if (state.watchIntervalId != null) {
      clearInterval(state.watchIntervalId);
      state.watchIntervalId = null;
    }
  }

  function isContextInvalidatedError(error) {
    const message =
      typeof error === "string"
        ? error
        : error?.message || chrome.runtime?.lastError?.message || "";
    return /extension context invalidated/i.test(message);
  }

  function callChrome(apiCall) {
    if (!isAlive()) return Promise.resolve(null);

    try {
      const result = apiCall();
      // Newer Chrome returns a Promise even when a callback is also used.
      if (result && typeof result.then === "function") {
        return result.catch((error) => {
          if (isContextInvalidatedError(error)) {
            markDead();
          }
          return null;
        });
      }
      return Promise.resolve(result);
    } catch (error) {
      if (isContextInvalidatedError(error)) {
        markDead();
      }
      return Promise.resolve(null);
    }
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      if (!isAlive()) {
        resolve(null);
        return;
      }

      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const promise = callChrome(() =>
        chrome.storage.local.get(key, (result) => {
          try {
            if (!isAlive()) {
              finish(null);
              return;
            }
            if (chrome.runtime.lastError) {
              if (isContextInvalidatedError(chrome.runtime.lastError)) {
                markDead();
              }
              finish(null);
              return;
            }
            finish(result);
          } catch (error) {
            if (isContextInvalidatedError(error)) {
              markDead();
            }
            finish(null);
          }
        }),
      );

      promise.then((value) => {
        if (value && !settled) finish(value);
      });
    });
  }

  function storageSet(value) {
    return callChrome(() =>
      chrome.storage.local.set(value, () => {
        try {
          if (
            chrome.runtime.lastError &&
            isContextInvalidatedError(chrome.runtime.lastError)
          ) {
            markDead();
          }
        } catch (error) {
          if (isContextInvalidatedError(error)) {
            markDead();
          }
        }
      }),
    );
  }

  function storageRemove(key) {
    return callChrome(() =>
      chrome.storage.local.remove(key, () => {
        try {
          if (
            chrome.runtime.lastError &&
            isContextInvalidatedError(chrome.runtime.lastError)
          ) {
            markDead();
          }
        } catch (error) {
          if (isContextInvalidatedError(error)) {
            markDead();
          }
        }
      }),
    );
  }

  function sendStatusMessage(message) {
    return new Promise((resolve) => {
      if (!isAlive()) {
        resolve(null);
        return;
      }

      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      try {
        const maybePromise = chrome.runtime.sendMessage(message, (response) => {
          try {
            if (!isAlive()) {
              finish(null);
              return;
            }
            if (chrome.runtime.lastError) {
              if (isContextInvalidatedError(chrome.runtime.lastError)) {
                markDead();
              }
              // Transient SW/port errors should not stop watching.
              finish(null);
              return;
            }
            finish(response);
          } catch (error) {
            if (isContextInvalidatedError(error)) {
              markDead();
            }
            finish(null);
          }
        });

        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(finish).catch((error) => {
            if (isContextInvalidatedError(error)) {
              markDead();
            }
            finish(null);
          });
        }
      } catch (error) {
        if (isContextInvalidatedError(error)) {
          markDead();
        }
        finish(null);
      }
    });
  }

  async function pollStatus() {
    if (!isAlive()) return;

    const response = await sendStatusMessage({
      status: getChecksStatusText(),
      title: getPrTitle(),
      pr: parsePrFromUrl(),
    });

    if (!isAlive()) return;

    if (!document.getElementById("github-pr-watcher-icon")) {
      stopWatching();
      return;
    }

    if (response === "processing" || response == null) {
      setIcon("loading");
      return;
    }

    setIcon("idle");
    stopWatching();
    await storageRemove(window.location.href);
  }

  async function startWatching() {
    if (!isAlive()) return;
    if (!setIcon("loading")) return;

    await storageSet({ [window.location.href]: true });
    if (!isAlive()) return;

    stopWatching();
    state.watchIntervalId = setInterval(() => {
      void pollStatus();
    }, 2000);
    await pollStatus();
  }

  async function setup() {
    if (!isAlive()) return;
    if (!parsePrFromUrl()) return;
    if (!initResourceUrls()) return;

    const actions = getActionsContainer();
    if (!actions) return;

    if (document.getElementById("github-pr-watcher-button")) return;

    const button = createWatchButton();
    if (!button) return;

    button.addEventListener("click", () => {
      void startWatching();
    });
    actions.appendChild(button);

    const stored = await storageGet(window.location.href);
    if (stored && stored[window.location.href]) {
      await startWatching();
    }
  }

  // Fresh inject after extension reload should treat context as alive again.
  state.dead = false;
  stopWatching();
  state.runSetup = () => {
    void setup();
  };

  void setup();

  if (!state.observer) {
    state.observer = new MutationObserver(() => {
      if (!isAlive()) return;
      clearTimeout(state.timeoutForObserver);
      state.timeoutForObserver = setTimeout(() => {
        state.runSetup?.();
      }, 200);
    });

    try {
      state.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch {
      markDead();
    }
  }
})();
