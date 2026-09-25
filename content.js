(function initCollapsibleNotepad() {
  // Cleanup legacy/duplicate UIs from older builds.
  try {
    const legacyIds = ["collapsible-notepad-root", "collapsible-notepad-root-v2"];
    for (const id of legacyIds) {
      const el = document.getElementById(id);
      if (el) {
        el.remove();
      }
    }

    const cnRoots = Array.from(document.querySelectorAll(".cn-root"));
    for (const el of cnRoots) {
      el.remove();
    }

    const cbnRoots = Array.from(document.querySelectorAll("#cbn-root"));
    if (cbnRoots.length > 1) {
      for (const el of cbnRoots.slice(1)) {
        el.remove();
      }
    }
  } catch {
    // If a page blocks DOM operations oddly, fail open.
  }

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
        <textarea class="cbn-editor" placeholder="share your thoughts or quick jots!"></textarea>
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
  let lastAppliedRevision = 0;

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

  function flushPendingSave() {
    if (!saveTimer) {
      return;
    }
    clearTimeout(saveTimer);
    saveTimer = null;
    saveState();
  }

  function buildPersistedState() {
    return {
      visible: state.visible,
      collapsed: state.collapsed,
      mode: state.mode,
      position: { ...state.position },
      activeNoteId: state.activeNoteId,
      notes: state.notes.map((note) => ({
        id: note.id,
        title: note.title,
        text: note.text
      }))
    };
  }

  function saveState() {
    const activeNote = getActiveNote();
    if (activeNote) {
      activeNote.text = editor.value;
    }

    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const baseRevision = result[STORAGE_KEY]?.syncRevision || 0;
      const nextRevision = baseRevision + 1;
      lastAppliedRevision = nextRevision;
      chrome.storage.local.set({
        [STORAGE_KEY]: {
          ...buildPersistedState(),
          syncRevision: nextRevision
        }
      });
    });
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

    if (Number.isFinite(saved.syncRevision)) {
      lastAppliedRevision = Math.max(lastAppliedRevision, saved.syncRevision);
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

  function applyPersistedState(saved) {
    normalizeLoadedState(saved);
    ensureValidState();
    clampPosition();
    applyPosition();
    updateMode();
    updateCollapsed();
    updateVisibility();
    updateEditorFromActiveNote();
  }

  function loadState() {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      applyPersistedState(result[STORAGE_KEY]);
    });
  }

  function refreshStateFromStorage(done) {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const saved = result[STORAGE_KEY];
      if (saved && typeof saved === "object") {
        const remoteRevision = saved.syncRevision || 0;
        if (remoteRevision > lastAppliedRevision) {
          applyPersistedState(saved);
        }
      }

      if (done) {
        done();
      }
    });
  }

  function toggleVisibility() {
    state.visible = !state.visible;
    updateVisibility();

    if (state.visible) {
      refreshStateFromStorage(() => {
        state.visible = true;
        updateVisibility();
        saveState();
      });
      return;
    }

    flushPendingSave();
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

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPendingSave();
    }
  });

  window.addEventListener("pagehide", flushPendingSave);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) {
      return;
    }

    const saved = changes[STORAGE_KEY].newValue;
    if (!saved || typeof saved !== "object") {
      return;
    }

    const remoteRevision = saved.syncRevision || 0;
    if (remoteRevision <= lastAppliedRevision) {
      return;
    }

    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    applyPersistedState(saved);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "TOGGLE_NOTEPAD") {
      toggleVisibility();
    }
  });

  loadState();
})();
