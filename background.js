chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) {
    return;
  }

  const toggleMessage = { type: "TOGGLE_NOTEPAD" };

  try {
    await chrome.tabs.sendMessage(tab.id, toggleMessage);
  } catch (error) {
    const message = String(error?.message || "");
    const missingReceiver = message.includes("Receiving end does not exist");

    if (!missingReceiver) {
      console.error("Failed to toggle notepad:", error);
      return;
    }

    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content.css"]
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      await chrome.tabs.sendMessage(tab.id, toggleMessage);
    } catch (injectionError) {
      console.warn("Notepad cannot run on this page.", injectionError);
    }
  }
});
