(function initCollapsibleNotepad() {
  if (window.__cbnInjected) {
    return;
  }
  window.__cbnInjected = true;

  const STORAGE_KEY = "cbn_state";
  const DEFAULT_NOTE_TITLE = "Note 1";
  const DEFAULT_STATE = {
    visible: false,
    collapsed: false,
    mode: "edit",
    position: { top: 70, right: 20 },
    activeNoteId: "note-1",
    notes: [
      {
        id: "note-1",
        title: DEFAULT_NOTE_TITLE,
        text: ""
      }
    ]
  };

  const state = JSON.parse(JSON.stringify(DEFAULT_STATE));

  const root = document.createElement("div");
  root.id = "cbn-root";
  root.classList.add("cbn-hidden");
  root.innerHTML = `
    <section class="cbn-panel">
      <header class="cbn-header">
        <span class="cbn-title">Browser Notepad</span>
        <div class="cbn-controls">
          <button class="cbn-btn cbn-collapse" type="button" title="Collapse panel">Collapse</button>
          <button class="cbn-btn cbn-close" type="button" title="Hide panel">Hide</button>
        </div>
      </header>
      <div class="cbn-body">
        <div class="cbn-note-tabs">
          <div class="cbn-note-tab-list" role="tablist" aria-label="Note tabs"></div>
          <button class="cbn-btn cbn-note-add" type="button" title="Add new note">+ Note</button>
        </div>
        <div class="cbn-note-actions">
          <button class="cbn-btn cbn-note-rename" type="button">Rename</button>
          <button class="cbn-btn cbn-note-delete" type="button">Delete</button>
        </div>
        <div class="cbn-mode" role="tablist" aria-label="Notepad mode">
          <button class="cbn-tab cbn-edit-tab" type="button" role="tab" aria-selected="true">Edit</button>
          <button class="cbn-tab cbn-preview-tab" type="button" role="tab" aria-selected="false">Preview</button>
        </div>
        <textarea class="cbn-editor" placeholder="Write notes with markdown..."></textarea>
        <article class="cbn-preview cbn-hidden"></article>
      </div>
    </section>
  `;

  document.documentElement.appendChild(root);

  const panel = root.querySelector(".cbn-panel");
  const header = root.querySelector(".cbn-header");
  const collapseButton = root.querySelector(".cbn-collapse");
  const closeButton = root.querySelector(".cbn-close");
  const editor = root.querySelector(".cbn-editor");
  const preview = root.querySelector(".cbn-preview");
  const editTab = root.querySelector(".cbn-edit-tab");
  const previewTab = root.querySelector(".cbn-preview-tab");
  const noteTabList = root.querySelector(".cbn-note-tab-list");
  const addNoteButton = root.querySelector(".cbn-note-add");
  const renameNoteButton = root.querySelector(".cbn-note-rename");
  const deleteNoteButton = root.querySelector(".cbn-note-delete");

  let saveTimer;
  let dragState = null;

  function sanitize(text) {
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function inlineMarkdown(text) {
    return text
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function renderMarkdown(source) {
    const escaped = sanitize(source).replace(/\r\n/g, "\n");
    const lines = escaped.split("\n");
    const html = [];
    let inCode = false;
    let listType = "";

    const closeListIfNeeded = () => {
      if (!listType) {
        return;
      }
      html.push(`</${listType}>`);
      listType = "";
    };

    for (const line of lines) {
      if (line.startsWith("```")) {
        closeListIfNeeded();
        if (!inCode) {
          html.push("<pre><code>");
          inCode = true;
        } else {
          html.push("</code></pre>");
          inCode = false;
        }
        continue;
      }

      if (inCode) {
        html.push(`${line}\n`);
        continue;
      }

      if (!line.trim()) {
        closeListIfNeeded();
        continue;
      }

      if (line.startsWith("### ")) {
        closeListIfNeeded();
        html.push(`<h3>${inlineMarkdown(line.slice(4))}</h3>`);
        continue;
      }

      if (line.startsWith("## ")) {
        closeListIfNeeded();
        html.push(`<h2>${inlineMarkdown(line.slice(3))}</h2>`);
        continue;
      }

      if (line.startsWith("# ")) {
        closeListIfNeeded();
        html.push(`<h1>${inlineMarkdown(line.slice(2))}</h1>`);
        continue;
      }

      if (line.startsWith("> ")) {
        closeListIfNeeded();
        html.push(`<blockquote>${inlineMarkdown(line.slice(2))}</blockquote>`);
        continue;
      }

      const unorderedMatch = line.match(/^[-*]\s+(.+)/);
      if (unorderedMatch) {
        if (listType !== "ul") {
          closeListIfNeeded();
          listType = "ul";
          html.push("<ul>");
        }
        html.push(`<li>${inlineMarkdown(unorderedMatch[1])}</li>`);
        continue;
      }

      const orderedMatch = line.match(/^\d+\.\s+(.+)/);
      if (orderedMatch) {
        if (listType !== "ol") {
          closeListIfNeeded();
          listType = "ol";
          html.push("<ol>");
        }
        html.push(`<li>${inlineMarkdown(orderedMatch[1])}</li>`);
        continue;
      }

      closeListIfNeeded();
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    }

    closeListIfNeeded();
    if (inCode) {
      html.push("</code></pre>");
    }
    return html.join("");
  }

  function generateNoteId() {
    return `note-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  function getActiveNote() {
    return state.notes.find((note) => note.id === state.activeNoteId) || state.notes[0];
  }

  function ensureValidState() {
    if (!Array.isArray(state.notes) || !state.notes.length) {
      state.notes = JSON.parse(JSON.stringify(DEFAULT_STATE.notes));
      state.activeNoteId = state.notes[0].id;
      return;
    }
    if (!state.notes.some((note) => note.id === state.activeNoteId)) {
      state.activeNoteId = state.notes[0].id;
    }
  }

  function applyPosition() {
    root.style.top = `${Math.max(0, state.position.top)}px`;
    root.style.right = `${Math.max(0, state.position.right)}px`;
  }

  function updateVisibility() {
    root.classList.toggle("cbn-hidden", !state.visible);
  }

  function updateCollapsed() {
    panel.classList.toggle("cbn-collapsed", state.collapsed);
    collapseButton.textContent = state.collapsed ? "Expand" : "Collapse";
  }

  function updateMode() {
    const inEdit = state.mode === "edit";
    editor.classList.toggle("cbn-hidden", !inEdit);
    preview.classList.toggle("cbn-hidden", inEdit);
    editTab.setAttribute("aria-selected", String(inEdit));
    previewTab.setAttribute("aria-selected", String(!inEdit));
  }

  function updatePreview() {
    const activeNote = getActiveNote();
    preview.innerHTML = renderMarkdown(activeNote ? activeNote.text : "");
  }

  function renderNoteTabs() {
    noteTabList.replaceChildren();
    state.notes.forEach((note) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cbn-note-tab";
      button.dataset.noteId = note.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(note.id === state.activeNoteId));
      button.textContent = note.title || "Untitled";
      noteTabList.appendChild(button);
    });
  }

  function updateEditorFromActiveNote() {
    const activeNote = getActiveNote();
    editor.value = activeNote ? activeNote.text : "";
    updatePreview();
    renderNoteTabs();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveState, 160);
  }

  function saveState() {
    const activeNote = getActiveNote();
    if (activeNote) {
      activeNote.text = editor.value;
    }
    chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  function clampPosition() {
    const width = root.offsetWidth || 360;
    const safeTop = Math.max(0, Math.min(state.position.top, window.innerHeight - 52));
    const left = window.innerWidth - state.position.right - width;
    const safeLeft = Math.max(0, Math.min(left, window.innerWidth - 40));
    state.position.top = safeTop;
    state.position.right = Math.max(0, window.innerWidth - safeLeft - width);
  }

  function normalizeLoadedState(saved) {
    if (!saved || typeof saved !== "object") {
      return;
    }

    state.visible = Boolean(saved.visible);
    state.collapsed = Boolean(saved.collapsed);
    state.mode = saved.mode === "preview" ? "preview" : "edit";

    if (saved.position && Number.isFinite(saved.position.top) && Number.isFinite(saved.position.right)) {
      state.position = { top: saved.position.top, right: saved.position.right };
    }

    if (Array.isArray(saved.notes) && saved.notes.length > 0) {
      state.notes = saved.notes
        .filter((item) => item && typeof item === "object")
        .map((item, index) => ({
          id: typeof item.id === "string" && item.id ? item.id : `note-restored-${index + 1}`,
          title:
            typeof item.title === "string" && item.title.trim()
              ? item.title.trim().slice(0, 28)
              : `Note ${index + 1}`,
          text: typeof item.text === "string" ? item.text : ""
        }));
      state.activeNoteId =
        typeof saved.activeNoteId === "string" && saved.activeNoteId
          ? saved.activeNoteId
          : state.notes[0].id;
      ensureValidState();
      return;
    }

    // Migrate from older single-note state shape.
    const migratedText = typeof saved.text === "string" ? saved.text : "";
    state.notes = [
      {
        id: "note-1",
        title: DEFAULT_NOTE_TITLE,
        text: migratedText
      }
    ];
    state.activeNoteId = "note-1";
  }

  function loadState() {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      normalizeLoadedState(result[STORAGE_KEY]);
      ensureValidState();
      clampPosition();
      applyPosition();
      updateMode();
      updateCollapsed();
      updateVisibility();
      updateEditorFromActiveNote();
      saveState();
    });
  }

  function toggleVisibility() {
    state.visible = !state.visible;
    updateVisibility();
    saveState();
  }

  function setMode(mode) {
    state.mode = mode;
    updateMode();
    saveState();
  }

  function createNote() {
    const noteNumber = state.notes.length + 1;
    const note = {
      id: generateNoteId(),
      title: `Note ${noteNumber}`,
      text: ""
    };
    state.notes.push(note);
    state.activeNoteId = note.id;
    updateEditorFromActiveNote();
    saveState();
  }

  function renameActiveNote() {
    const activeNote = getActiveNote();
    if (!activeNote) {
      return;
    }
    const input = window.prompt("Rename note:", activeNote.title);
    if (input === null) {
      return;
    }
    const trimmed = input.trim().slice(0, 28);
    activeNote.title = trimmed || "Untitled";
    renderNoteTabs();
    saveState();
  }

  function deleteActiveNote() {
    if (state.notes.length === 1) {
      window.alert("At least one note must remain.");
      return;
    }

    const activeNote = getActiveNote();
    if (!activeNote) {
      return;
    }
    const confirmed = window.confirm(`Delete "${activeNote.title}"?`);
    if (!confirmed) {
      return;
    }

    state.notes = state.notes.filter((note) => note.id !== activeNote.id);
    state.activeNoteId = state.notes[0].id;
    updateEditorFromActiveNote();
    saveState();
  }

  editor.addEventListener("input", () => {
    const activeNote = getActiveNote();
    if (activeNote) {
      activeNote.text = editor.value;
    }
    updatePreview();
    scheduleSave();
  });

  noteTabList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const button = target.closest(".cbn-note-tab");
    if (!button) {
      return;
    }
    const noteId = button.dataset.noteId;
    if (!noteId || noteId === state.activeNoteId) {
      return;
    }
    const current = getActiveNote();
    if (current) {
      current.text = editor.value;
    }
    state.activeNoteId = noteId;
    updateEditorFromActiveNote();
    saveState();
  });

  addNoteButton.addEventListener("click", createNote);
  renameNoteButton.addEventListener("click", renameActiveNote);
  deleteNoteButton.addEventListener("click", deleteActiveNote);

  collapseButton.addEventListener("click", () => {
    state.collapsed = !state.collapsed;
    updateCollapsed();
    saveState();
  });

  closeButton.addEventListener("click", () => {
    state.visible = false;
    updateVisibility();
    saveState();
  });

  editTab.addEventListener("click", () => setMode("edit"));
  previewTab.addEventListener("click", () => {
    updatePreview();
    setMode("preview");
  });

  header.addEventListener("pointerdown", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest("button")) {
      return;
    }

    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      startTop: state.position.top,
      startRight: state.position.right
    };
    header.setPointerCapture(event.pointerId);
  });

  header.addEventListener("pointermove", (event) => {
    if (!dragState) {
      return;
    }
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    state.position.top = dragState.startTop + dy;
    state.position.right = dragState.startRight - dx;
    clampPosition();
    applyPosition();
  });

  const finishDrag = () => {
    if (!dragState) {
      return;
    }
    dragState = null;
    saveState();
  };

  header.addEventListener("pointerup", finishDrag);
  header.addEventListener("pointercancel", finishDrag);

  window.addEventListener("resize", () => {
    clampPosition();
    applyPosition();
    saveState();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "TOGGLE_NOTEPAD") {
      toggleVisibility();
    }
  });

  loadState();
})();
(function initCollapsibleNotepad() {
  if (window.__cbnInjected) {
    return;
  }
  window.__cbnInjected = true;

  const STORAGE_KEY = "cbn_state";
  const DEFAULT_STATE = {
    text: "",
    visible: false,
    collapsed: false,
    mode: "edit",
    position: { top: 70, right: 20 }
  };

  const state = { ...DEFAULT_STATE, position: { ...DEFAULT_STATE.position } };

  const root = document.createElement("div");
  root.id = "cbn-root";
  root.classList.add("cbn-hidden");
  root.innerHTML = `
    <section class="cbn-panel">
      <header class="cbn-header">
        <span class="cbn-title">Browser Notepad</span>
        <div class="cbn-controls">
          <button class="cbn-btn cbn-collapse" type="button" title="Collapse panel">Collapse</button>
          <button class="cbn-btn cbn-close" type="button" title="Hide panel">Hide</button>
        </div>
      </header>
      <div class="cbn-body">
        <div class="cbn-mode" role="tablist" aria-label="Notepad mode">
          <button class="cbn-tab cbn-edit-tab" type="button" role="tab" aria-selected="true">Edit</button>
          <button class="cbn-tab cbn-preview-tab" type="button" role="tab" aria-selected="false">Preview</button>
        </div>
        <textarea class="cbn-editor" placeholder="Write notes with markdown..."></textarea>
        <article class="cbn-preview cbn-hidden"></article>
      </div>
    </section>
  `;

  document.documentElement.appendChild(root);

  const panel = root.querySelector(".cbn-panel");
  const header = root.querySelector(".cbn-header");
  const collapseButton = root.querySelector(".cbn-collapse");
  const closeButton = root.querySelector(".cbn-close");
  const editor = root.querySelector(".cbn-editor");
  const preview = root.querySelector(".cbn-preview");
  const editTab = root.querySelector(".cbn-edit-tab");
  const previewTab = root.querySelector(".cbn-preview-tab");

  let saveTimer;
  let dragState = null;

  function sanitize(text) {
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function inlineMarkdown(text) {
    return text
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function renderMarkdown(source) {
    const escaped = sanitize(source).replace(/\r\n/g, "\n");
    const lines = escaped.split("\n");
    const html = [];
    let inCode = false;
    let listType = "";

    const closeListIfNeeded = () => {
      if (!listType) {
        return;
      }
      html.push(`</${listType}>`);
      listType = "";
    };

    for (const line of lines) {
      if (line.startsWith("```")) {
        closeListIfNeeded();
        if (!inCode) {
          html.push("<pre><code>");
          inCode = true;
        } else {
          html.push("</code></pre>");
          inCode = false;
        }
        continue;
      }

      if (inCode) {
        html.push(`${line}\n`);
        continue;
      }

      if (!line.trim()) {
        closeListIfNeeded();
        continue;
      }

      if (line.startsWith("### ")) {
        closeListIfNeeded();
        html.push(`<h3>${inlineMarkdown(line.slice(4))}</h3>`);
        continue;
      }

      if (line.startsWith("## ")) {
        closeListIfNeeded();
        html.push(`<h2>${inlineMarkdown(line.slice(3))}</h2>`);
        continue;
      }

      if (line.startsWith("# ")) {
        closeListIfNeeded();
        html.push(`<h1>${inlineMarkdown(line.slice(2))}</h1>`);
        continue;
      }

      if (line.startsWith("> ")) {
        closeListIfNeeded();
        html.push(`<blockquote>${inlineMarkdown(line.slice(2))}</blockquote>`);
        continue;
      }

      const unorderedMatch = line.match(/^[-*]\s+(.+)/);
      if (unorderedMatch) {
        if (listType !== "ul") {
          closeListIfNeeded();
          listType = "ul";
          html.push("<ul>");
        }
        html.push(`<li>${inlineMarkdown(unorderedMatch[1])}</li>`);
        continue;
      }

      const orderedMatch = line.match(/^\d+\.\s+(.+)/);
      if (orderedMatch) {
        if (listType !== "ol") {
          closeListIfNeeded();
          listType = "ol";
          html.push("<ol>");
        }
        html.push(`<li>${inlineMarkdown(orderedMatch[1])}</li>`);
        continue;
      }

      closeListIfNeeded();
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    }

    closeListIfNeeded();
    if (inCode) {
      html.push("</code></pre>");
    }
    return html.join("");
  }

  function applyPosition() {
    root.style.top = `${Math.max(0, state.position.top)}px`;
    root.style.right = `${Math.max(0, state.position.right)}px`;
  }

  function updateVisibility() {
    root.classList.toggle("cbn-hidden", !state.visible);
  }

  function updateCollapsed() {
    panel.classList.toggle("cbn-collapsed", state.collapsed);
    collapseButton.textContent = state.collapsed ? "Expand" : "Collapse";
  }

  function updateMode() {
    const inEdit = state.mode === "edit";
    editor.classList.toggle("cbn-hidden", !inEdit);
    preview.classList.toggle("cbn-hidden", inEdit);
    editTab.setAttribute("aria-selected", String(inEdit));
    previewTab.setAttribute("aria-selected", String(!inEdit));
  }

  function updatePreview() {
    preview.innerHTML = renderMarkdown(editor.value);
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveState, 160);
  }

  function saveState() {
    state.text = editor.value;
    chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  function clampPosition() {
    const width = root.offsetWidth || 360;
    const safeTop = Math.max(0, Math.min(state.position.top, window.innerHeight - 52));
    const left = window.innerWidth - state.position.right - width;
    const safeLeft = Math.max(0, Math.min(left, window.innerWidth - 40));
    state.position.top = safeTop;
    state.position.right = Math.max(0, window.innerWidth - safeLeft - width);
  }

  function loadState() {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const saved = result[STORAGE_KEY];
      if (saved && typeof saved === "object") {
        state.text = typeof saved.text === "string" ? saved.text : state.text;
        state.visible = Boolean(saved.visible);
        state.collapsed = Boolean(saved.collapsed);
        state.mode = saved.mode === "preview" ? "preview" : "edit";
        if (saved.position && Number.isFinite(saved.position.top) && Number.isFinite(saved.position.right)) {
          state.position = {
            top: saved.position.top,
            right: saved.position.right
          };
        }
      }

      editor.value = state.text;
      clampPosition();
      applyPosition();
      updatePreview();
      updateMode();
      updateCollapsed();
      updateVisibility();
    });
  }

  function toggleVisibility() {
    state.visible = !state.visible;
    updateVisibility();
    saveState();
  }

  function setMode(mode) {
    state.mode = mode;
    updateMode();
    saveState();
  }

  editor.addEventListener("input", () => {
    updatePreview();
    scheduleSave();
  });

  collapseButton.addEventListener("click", () => {
    state.collapsed = !state.collapsed;
    updateCollapsed();
    saveState();
  });

  closeButton.addEventListener("click", () => {
    state.visible = false;
    updateVisibility();
    saveState();
  });

  editTab.addEventListener("click", () => setMode("edit"));
  previewTab.addEventListener("click", () => {
    updatePreview();
    setMode("preview");
  });

  header.addEventListener("pointerdown", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest("button")) {
      return;
    }

    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      startTop: state.position.top,
      startRight: state.position.right
    };
    header.setPointerCapture(event.pointerId);
  });

  header.addEventListener("pointermove", (event) => {
    if (!dragState) {
      return;
    }
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    state.position.top = dragState.startTop + dy;
    state.position.right = dragState.startRight - dx;
    clampPosition();
    applyPosition();
  });

  const finishDrag = () => {
    if (!dragState) {
      return;
    }
    dragState = null;
    saveState();
  };

  header.addEventListener("pointerup", finishDrag);
  header.addEventListener("pointercancel", finishDrag);

  window.addEventListener("resize", () => {
    clampPosition();
    applyPosition();
    saveState();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "TOGGLE_NOTEPAD") {
      toggleVisibility();
    }
  });

  loadState();
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
