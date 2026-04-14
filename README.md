# Collapsible Browser Notepad (Chrome Extension)

This extension adds a floating notepad that opens/closes from the extension toolbar icon.  
The note content, collapsed/expanded state, panel visibility, and panel position are saved in `chrome.storage.local`.

## Features

- Floating note panel on all websites
- Open/close from the Chrome extension icon
- Collapse/expand with one click
- Drag to reposition
- Auto-save note text in browser storage
- Markdown editor with live preview mode
- Polished UI with modern styling

## Install locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this `ChromeExtension` folder.

## Use

- Click the extension icon in Chrome's toolbar to toggle the notepad on the current tab.

## Files

- `manifest.json` - extension manifest (MV3)
- `content.js` - UI + storage behavior
- `content.css` - notepad styling
