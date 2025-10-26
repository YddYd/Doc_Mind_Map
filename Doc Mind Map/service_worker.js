// Open Side Panel
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true });
});

chrome.action?.onClicked?.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
  console.log("[StructDoc] side-panel opened");
});
