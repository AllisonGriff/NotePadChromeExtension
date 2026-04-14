(() => {
  const STORAGE_KEY = "collapsibleNotepadState";
  const ROOT_ID = "collapsible-notepad-root";

  if (document.getElementById(ROOT_ID)) {
    return;
  }

  const fontOptions = [
    { label: "Inter", value: "Inter, Segoe UI, Arial, sans-serif" },
    { label: "Arial", value: "Arial, Helvetica, sans-serif" },
    { label: "Georgia", value: "Georgia, Times New Roman, serif" },
    { label: "Courier New", value: "Courier New, Courier, monospace" },
    { label: "Comic Sans MS", value: "Comic Sans MS, Comic Sans, cursive" }
  ];

  const defaultState = {
    contentHtml: "",
    collapsed: false,
    mode: "edit",
    uiVisible: false,
    position: { top: 90, right: 20 }
  };

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.className = "cn-root";

  const header = document.createElement("div");
  header.className = "cn-header";

  const title = document.createElement("span");
  title.className = "cn-title";
  title.textContent = "Notepad";

  const controls = document.createElement("div");
  controls.className = "cn-controls";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "cn-btn cn-mode-btn is-active";
  editButton.setAttribute("aria-label", "Edit note");
  editButton.textContent = "Edit";

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.className = "cn-btn cn-mode-btn";
  previewButton.setAttribute("aria-label", "Preview note");
  previewButton.textContent = "Preview";

  const collapseButton = document.createElement("button");
  collapseButton.type = "button";
  collapseButton.className = "cn-btn cn-collapse-btn";
  collapseButton.setAttribute("aria-label", "Collapse notepad");
  collapseButton.textContent = "−";

  controls.appendChild(editButton);
  controls.appendChild(previewButton);
  controls.appendChild(collapseButton);
  header.appendChild(title);
  header.appendChild(controls);

  const body = document.createElement("div");
  body.className = "cn-body";

  const toolbar = document.createElement("div");
  toolbar.className = "cn-toolbar";

  const highlightButton = document.createElement("button");
  highlightButton.type = "button";
  highlightButton.className = "cn-btn cn-tool-btn";
  highlightButton.setAttribute("aria-label", "Highlight selected text");
  highlightButton.title = "Highlight selected text (Ctrl+Shift+H)";
  highlightButton.textContent = "Highlight";

  const fontSelect = document.createElement("select");
  fontSelect.className = "cn-font-select";
  fontSelect.setAttribute("aria-label", "Choose font");
  for (const optionData of fontOptions) {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    fontSelect.appendChild(option);
  }

  toolbar.appendChild(highlightButton);
  toolbar.appendChild(fontSelect);

  const editor = document.createElement("div");
  editor.className = "cn-editor";
  editor.setAttribute("contenteditable", "true");
  editor.setAttribute("aria-label", "Notepad");
  editor.setAttribute("role", "textbox");
  editor.setAttribute("data-placeholder", "Write your notes here...");

  const preview = document.createElement("div");
  preview.className = "cn-preview";
  preview.setAttribute("aria-live", "polite");

  body.appendChild(toolbar);
  body.appendChild(editor);
  body.appendChild(preview);

  root.appendChild(header);
  root.appendChild(body);
  document.documentElement.appendChild(root);

  let state = { ...defaultState };
  let saveTimer = null;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let startTop = 0;
  let startRight = 0;
  let lastRange = null;
  let highlightModeEnabled = false;

  const allowedTags = new Set(["DIV", "BR", "SPAN", "FONT", "B", "STRONG", "I", "EM", "U", "MARK"]);

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function persistState() {
    chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  function persistStateDebounced() {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      persistState();
      saveTimer = null;
    }, 200);
  }

  function applyPosition() {
    const maxTop = Math.max(10, window.innerHeight - 50);
    const maxRight = Math.max(10, window.innerWidth - 50);
    state.position.top = clamp(state.position.top, 10, maxTop);
    state.position.right = clamp(state.position.right, 10, maxRight);
    root.style.top = `${state.position.top}px`;
    root.style.right = `${state.position.right}px`;
  }

  function applyCollapse() {
    if (state.collapsed) {
      root.classList.add("is-collapsed");
      collapseButton.textContent = "+";
      collapseButton.setAttribute("aria-label", "Expand notepad");
    } else {
      root.classList.remove("is-collapsed");
      collapseButton.textContent = "−";
      collapseButton.setAttribute("aria-label", "Collapse notepad");
    }
  }

  function applyVisibility() {
    root.classList.toggle("is-hidden", !state.uiVisible);
  }

  function setVisibility(visible) {
    state.uiVisible = Boolean(visible);
    applyVisibility();
  }

  function setMode(mode) {
    state.mode = mode === "preview" ? "preview" : "edit";
    const isPreview = state.mode === "preview";
    root.classList.toggle("is-preview", isPreview);
    editButton.classList.toggle("is-active", !isPreview);
    previewButton.classList.toggle("is-active", isPreview);
  }

  function isAllowedFontFamily(value) {
    return fontOptions.some((optionData) => optionData.value === value);
  }

  function sanitizeHtml(rawHtml) {
    if (!rawHtml) {
      return "";
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${rawHtml}</div>`, "text/html");
    const wrapper = doc.body.firstElementChild;
    if (!wrapper) {
      return "";
    }

    function sanitizeNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return doc.createTextNode(node.textContent || "");
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return doc.createTextNode("");
      }

      const sourceElement = node;
      const tagName = sourceElement.tagName.toUpperCase();
      if (!allowedTags.has(tagName)) {
        const fragment = doc.createDocumentFragment();
        for (const childNode of Array.from(sourceElement.childNodes)) {
          fragment.appendChild(sanitizeNode(childNode));
        }
        return fragment;
      }

      const cleanElement = doc.createElement(tagName === "FONT" ? "span" : tagName.toLowerCase());
      if (tagName === "SPAN" || tagName === "FONT") {
        const styleValue = (sourceElement.style.fontFamily || sourceElement.getAttribute("face") || "").trim();
        if (styleValue && isAllowedFontFamily(styleValue)) {
          cleanElement.style.fontFamily = styleValue;
        }
      }

      for (const childNode of Array.from(sourceElement.childNodes)) {
        cleanElement.appendChild(sanitizeNode(childNode));
      }
      return cleanElement;
    }

    const cleanWrapper = doc.createElement("div");
    for (const childNode of Array.from(wrapper.childNodes)) {
      cleanWrapper.appendChild(sanitizeNode(childNode));
    }
    return cleanWrapper.innerHTML.trim();
  }

  function textToHtml(plainText) {
    return plainText
      .split(/\r?\n/)
      .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
      .join("<br>");
  }

  function renderPreview() {
    const cleanHtml = sanitizeHtml(state.contentHtml);
    preview.innerHTML = cleanHtml || "<p class=\"cn-preview-empty\">Start typing to preview your notes here.</p>";
  }

  function storeEditorContent() {
    state.contentHtml = sanitizeHtml(editor.innerHTML);
  }

  function captureSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      return;
    }
    lastRange = range.cloneRange();
  }

  function hasEditorSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return false;
    }
    const range = selection.getRangeAt(0);
    return editor.contains(range.commonAncestorContainer);
  }

  function setHighlightMode(enabled) {
    highlightModeEnabled = Boolean(enabled);
    highlightButton.classList.toggle("is-active", highlightModeEnabled);
    highlightButton.setAttribute("aria-pressed", String(highlightModeEnabled));
  }

  function restoreSelection() {
    editor.focus();
    const selection = window.getSelection();
    if (!selection) {
      return false;
    }
    selection.removeAllRanges();
    if (lastRange) {
      selection.addRange(lastRange);
      return true;
    }
    return false;
  }

  function applyHighlight() {
    if (!restoreSelection()) {
      return;
    }
    document.execCommand("hiliteColor", false, "#fff59d");
    captureSelection();
    storeEditorContent();
    renderPreview();
    persistStateDebounced();
  }

  function applyFont(fontFamily) {
    if (!isAllowedFontFamily(fontFamily) || !restoreSelection()) {
      return;
    }
    document.execCommand("fontName", false, fontFamily);
    captureSelection();
    storeEditorContent();
    renderPreview();
    persistStateDebounced();
  }

  function handleEditorSelectionChange() {
    captureSelection();
    if (!highlightModeEnabled || !hasEditorSelection()) {
      return;
    }
    applyHighlight();
  }

  function applyState() {
    editor.innerHTML = sanitizeHtml(state.contentHtml);
    renderPreview();
    setMode(state.mode);
    applyVisibility();
    applyPosition();
    applyCollapse();
  }

  function onPointerMove(event) {
    if (!isDragging) {
      return;
    }
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    state.position.top = startTop + dy;
    state.position.right = startRight - dx;
    applyPosition();
  }

  function onPointerUp() {
    if (!isDragging) {
      return;
    }
    isDragging = false;
    header.classList.remove("is-dragging");
    persistState();
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  header.addEventListener("pointerdown", (event) => {
    if (controls.contains(event.target)) {
      return;
    }
    isDragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    startTop = state.position.top;
    startRight = state.position.right;
    header.classList.add("is-dragging");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  });

  collapseButton.addEventListener("click", () => {
    state.collapsed = !state.collapsed;
    applyCollapse();
    persistState();
  });

  editButton.addEventListener("click", () => {
    setMode("edit");
    persistState();
  });

  previewButton.addEventListener("click", () => {
    setMode("preview");
    renderPreview();
    persistState();
  });

  highlightButton.addEventListener("click", () => {
    setHighlightMode(!highlightModeEnabled);
    if (highlightModeEnabled && hasEditorSelection()) {
      captureSelection();
      applyHighlight();
    }
  });

  fontSelect.addEventListener("change", () => {
    applyFont(fontSelect.value);
  });

  editor.addEventListener("keydown", (event) => {
    const isHighlightShortcut =
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === "h";

    if (!isHighlightShortcut) {
      return;
    }

    event.preventDefault();
    setHighlightMode(!highlightModeEnabled);
    if (highlightModeEnabled && hasEditorSelection()) {
      captureSelection();
      applyHighlight();
    }
  });

  editor.addEventListener("keyup", handleEditorSelectionChange);
  editor.addEventListener("mouseup", handleEditorSelectionChange);

  editor.addEventListener("input", () => {
    storeEditorContent();
    renderPreview();
    persistStateDebounced();
  });

  window.addEventListener("resize", () => {
    applyPosition();
    persistStateDebounced();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.type === "TOGGLE_NOTEPAD") {
      setVisibility(!state.uiVisible);
      persistState();
      sendResponse({ ok: true, visible: state.uiVisible });
      return true;
    }
    if (message.type === "SET_NOTEPAD_VISIBILITY") {
      setVisibility(Boolean(message.visible));
      persistState();
      sendResponse({ ok: true, visible: state.uiVisible });
      return true;
    }
    return undefined;
  });

  chrome.storage.local.get(STORAGE_KEY, (result) => {
    if (chrome.runtime.lastError) {
      applyState();
      return;
    }
    const stored = result[STORAGE_KEY];
    if (stored && typeof stored === "object") {
      const legacyText = typeof stored.text === "string" ? stored.text : "";
      state = {
        contentHtml:
          typeof stored.contentHtml === "string"
            ? sanitizeHtml(stored.contentHtml)
            : textToHtml(legacyText),
        collapsed: Boolean(stored.collapsed),
        mode: stored.mode === "preview" ? "preview" : "edit",
        uiVisible: Boolean(stored.uiVisible),
        position: {
          top:
            stored.position && typeof stored.position.top === "number"
              ? stored.position.top
              : defaultState.position.top,
          right:
            stored.position && typeof stored.position.right === "number"
              ? stored.position.right
              : defaultState.position.right
        }
      };
    }
    applyState();
  });
})();
(() => {
  const STORAGE_KEY = "collapsibleNotepadState";
  const ROOT_ID = "collapsible-notepad-root";

  if (document.getElementById(ROOT_ID)) {
    return;
  }

  const fontOptions = [
    { label: "Inter", value: "Inter, Segoe UI, Arial, sans-serif" },
    { label: "Arial", value: "Arial, Helvetica, sans-serif" },
    { label: "Georgia", value: "Georgia, Times New Roman, serif" },
    { label: "Courier New", value: "Courier New, Courier, monospace" },
    { label: "Comic Sans MS", value: "Comic Sans MS, Comic Sans, cursive" }
  ];

  const defaultState = {
    contentHtml: "",
    collapsed: false,
    mode: "edit",
    uiVisible: false,
    position: { top: 90, right: 20 }
  };

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.className = "cn-root";

  const header = document.createElement("div");
  header.className = "cn-header";

  const title = document.createElement("span");
  title.className = "cn-title";
  title.textContent = "Notepad";

  const controls = document.createElement("div");
  controls.className = "cn-controls";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "cn-btn cn-mode-btn is-active";
  editButton.setAttribute("aria-label", "Edit note");
  editButton.textContent = "Edit";

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.className = "cn-btn cn-mode-btn";
  previewButton.setAttribute("aria-label", "Preview note");
  previewButton.textContent = "Preview";

  const collapseButton = document.createElement("button");
  collapseButton.type = "button";
  collapseButton.className = "cn-btn cn-collapse-btn";
  collapseButton.setAttribute("aria-label", "Collapse notepad");
  collapseButton.textContent = "−";

  controls.appendChild(editButton);
  controls.appendChild(previewButton);
  controls.appendChild(collapseButton);
  header.appendChild(title);
  header.appendChild(controls);

  const body = document.createElement("div");
  body.className = "cn-body";

  const toolbar = document.createElement("div");
  toolbar.className = "cn-toolbar";

  const highlightButton = document.createElement("button");
  highlightButton.type = "button";
  highlightButton.className = "cn-btn cn-tool-btn";
  highlightButton.setAttribute("aria-label", "Highlight selected text");
  highlightButton.textContent = "Highlight";

  const fontSelect = document.createElement("select");
  fontSelect.className = "cn-font-select";
  fontSelect.setAttribute("aria-label", "Choose font");
  for (const optionData of fontOptions) {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    fontSelect.appendChild(option);
  }

  toolbar.appendChild(highlightButton);
  toolbar.appendChild(fontSelect);

  const editor = document.createElement("div");
  editor.className = "cn-editor";
  editor.setAttribute("contenteditable", "true");
  editor.setAttribute("aria-label", "Notepad");
  editor.setAttribute("role", "textbox");
  editor.setAttribute("data-placeholder", "Write your notes here...");

  const preview = document.createElement("div");
  preview.className = "cn-preview";
  preview.setAttribute("aria-live", "polite");

  body.appendChild(toolbar);
  body.appendChild(editor);
  body.appendChild(preview);

  root.appendChild(header);
  root.appendChild(body);
  document.documentElement.appendChild(root);

  let state = { ...defaultState };
  let saveTimer = null;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let startTop = 0;
  let startRight = 0;
  let lastRange = null;

  const allowedTags = new Set(["DIV", "BR", "SPAN", "FONT", "B", "STRONG", "I", "EM", "U", "MARK"]);

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function persistState() {
    chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  function persistStateDebounced() {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      persistState();
      saveTimer = null;
    }, 200);
  }

  function applyPosition() {
    const maxTop = Math.max(10, window.innerHeight - 50);
    const maxRight = Math.max(10, window.innerWidth - 50);
    state.position.top = clamp(state.position.top, 10, maxTop);
    state.position.right = clamp(state.position.right, 10, maxRight);
    root.style.top = `${state.position.top}px`;
    root.style.right = `${state.position.right}px`;
  }

  function applyCollapse() {
    if (state.collapsed) {
      root.classList.add("is-collapsed");
      collapseButton.textContent = "+";
      collapseButton.setAttribute("aria-label", "Expand notepad");
    } else {
      root.classList.remove("is-collapsed");
      collapseButton.textContent = "−";
      collapseButton.setAttribute("aria-label", "Collapse notepad");
    }
  }

  function applyVisibility() {
    root.classList.toggle("is-hidden", !state.uiVisible);
  }

  function setVisibility(visible) {
    state.uiVisible = Boolean(visible);
    applyVisibility();
  }

  function setMode(mode) {
    state.mode = mode === "preview" ? "preview" : "edit";
    const isPreview = state.mode === "preview";
    root.classList.toggle("is-preview", isPreview);
    editButton.classList.toggle("is-active", !isPreview);
    previewButton.classList.toggle("is-active", isPreview);
  }

  function isAllowedFontFamily(value) {
    return fontOptions.some((optionData) => optionData.value === value);
  }

  function sanitizeHtml(rawHtml) {
    if (!rawHtml) {
      return "";
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${rawHtml}</div>`, "text/html");
    const wrapper = doc.body.firstElementChild;
    if (!wrapper) {
      return "";
    }

    function sanitizeNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return doc.createTextNode(node.textContent || "");
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return doc.createTextNode("");
      }

      const sourceElement = node;
      const tagName = sourceElement.tagName.toUpperCase();
      if (!allowedTags.has(tagName)) {
        const fragment = doc.createDocumentFragment();
        for (const childNode of Array.from(sourceElement.childNodes)) {
          fragment.appendChild(sanitizeNode(childNode));
        }
        return fragment;
      }

      const cleanElement = doc.createElement(tagName === "FONT" ? "span" : tagName.toLowerCase());
      if (tagName === "SPAN" || tagName === "FONT") {
        const styleValue = (sourceElement.style.fontFamily || sourceElement.getAttribute("face") || "").trim();
        if (styleValue && isAllowedFontFamily(styleValue)) {
          cleanElement.style.fontFamily = styleValue;
        }
      }

      for (const childNode of Array.from(sourceElement.childNodes)) {
        cleanElement.appendChild(sanitizeNode(childNode));
      }
      return cleanElement;
    }

    const cleanWrapper = doc.createElement("div");
    for (const childNode of Array.from(wrapper.childNodes)) {
      cleanWrapper.appendChild(sanitizeNode(childNode));
    }
    return cleanWrapper.innerHTML.trim();
  }

  function textToHtml(plainText) {
    return plainText
      .split(/\r?\n/)
      .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
      .join("<br>");
  }

  function renderPreview() {
    const cleanHtml = sanitizeHtml(state.contentHtml);
    preview.innerHTML = cleanHtml || "<p class=\"cn-preview-empty\">Start typing to preview your notes here.</p>";
  }

  function storeEditorContent() {
    state.contentHtml = sanitizeHtml(editor.innerHTML);
  }

  function captureSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      return;
    }
    lastRange = range.cloneRange();
  }

  function restoreSelection() {
    editor.focus();
    const selection = window.getSelection();
    if (!selection) {
      return false;
    }
    selection.removeAllRanges();
    if (lastRange) {
      selection.addRange(lastRange);
      return true;
    }
    return false;
  }

  function applyHighlight() {
    if (!restoreSelection()) {
      return;
    }
    document.execCommand("hiliteColor", false, "#fff59d");
    storeEditorContent();
    editor.innerHTML = state.contentHtml;
    renderPreview();
    persistStateDebounced();
  }

  function applyFont(fontFamily) {
    if (!isAllowedFontFamily(fontFamily) || !restoreSelection()) {
      return;
    }
    document.execCommand("fontName", false, fontFamily);
    storeEditorContent();
    editor.innerHTML = state.contentHtml;
    renderPreview();
    persistStateDebounced();
  }

  function applyState() {
    editor.innerHTML = sanitizeHtml(state.contentHtml);
    renderPreview();
    setMode(state.mode);
    applyVisibility();
    applyPosition();
    applyCollapse();
  }

  function onPointerMove(event) {
    if (!isDragging) {
      return;
    }
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    state.position.top = startTop + dy;
    state.position.right = startRight - dx;
    applyPosition();
  }

  function onPointerUp() {
    if (!isDragging) {
      return;
    }
    isDragging = false;
    header.classList.remove("is-dragging");
    persistState();
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  header.addEventListener("pointerdown", (event) => {
    if (controls.contains(event.target) || toolbar.contains(event.target)) {
      return;
    }
    isDragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    startTop = state.position.top;
    startRight = state.position.right;
    header.classList.add("is-dragging");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  });

  collapseButton.addEventListener("click", () => {
    state.collapsed = !state.collapsed;
    applyCollapse();
    persistState();
  });

  editButton.addEventListener("click", () => {
    setMode("edit");
    persistState();
  });

  previewButton.addEventListener("click", () => {
    setMode("preview");
    renderPreview();
    persistState();
  });

  highlightButton.addEventListener("click", () => {
    applyHighlight();
  });

  fontSelect.addEventListener("change", () => {
    applyFont(fontSelect.value);
  });

  editor.addEventListener("keyup", captureSelection);
  editor.addEventListener("mouseup", captureSelection);

  editor.addEventListener("input", () => {
    storeEditorContent();
    renderPreview();
    persistStateDebounced();
  });

  window.addEventListener("resize", () => {
    applyPosition();
    persistStateDebounced();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.type === "TOGGLE_NOTEPAD") {
      setVisibility(!state.uiVisible);
      persistState();
      sendResponse({ ok: true, visible: state.uiVisible });
      return true;
    }
    if (message.type === "SET_NOTEPAD_VISIBILITY") {
      setVisibility(Boolean(message.visible));
      persistState();
      sendResponse({ ok: true, visible: state.uiVisible });
      return true;
    }
    return undefined;
  });

  chrome.storage.local.get(STORAGE_KEY, (result) => {
    if (chrome.runtime.lastError) {
      applyState();
      return;
    }
    const stored = result[STORAGE_KEY];
    if (stored && typeof stored === "object") {
      const legacyText = typeof stored.text === "string" ? stored.text : "";
      state = {
        contentHtml:
          typeof stored.contentHtml === "string"
            ? sanitizeHtml(stored.contentHtml)
            : textToHtml(legacyText),
        collapsed: Boolean(stored.collapsed),
        mode: stored.mode === "preview" ? "preview" : "edit",
        uiVisible: Boolean(stored.uiVisible),
        position: {
          top:
            stored.position && typeof stored.position.top === "number"
              ? stored.position.top
              : defaultState.position.top,
          right:
            stored.position && typeof stored.position.right === "number"
              ? stored.position.right
              : defaultState.position.right
        }
      };
    }
    applyState();
  });
})();
