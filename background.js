chrome.action.onClicked.addListener((tab) => {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_NOTEPAD" }, () => {
    // Some pages (like chrome://) do not allow content scripts.
    // Ignore sendMessage errors in those tabs.
    void chrome.runtime.lastError;
  });
});
