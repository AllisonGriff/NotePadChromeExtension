if (!window.__cbnThemeBridgeInjected) {
  window.__cbnThemeBridgeInjected = true;
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const toggleButton = target.closest(".cbn-theme-toggle");
      if (!toggleButton) {
        return;
      }

      const root = document.getElementById("cbn-root");
      if (!root) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      const currentTheme = root.dataset.theme === "light" ? "light" : "dark";
      const nextTheme = currentTheme === "dark" ? "light" : "dark";
      root.dataset.theme = nextTheme;
      toggleButton.textContent = nextTheme === "dark" ? "Light" : "Dark";

      chrome.storage.local.get("cbn_state", (result) => {
        const saved = result.cbn_state && typeof result.cbn_state === "object" ? result.cbn_state : {};
        chrome.storage.local.set({
          cbn_state: {
            ...saved,
            theme: nextTheme
          }
        });
      });
    },
    true
  );
}

(function initCollapsibleNotepad() {
  const LEGACY_ROOT_IDS = ["collapsible-notepad-root", "collapsible-notepad-root-v2"];
  for (const id of LEGACY_ROOT_IDS) {
    const el = document.getElementById(id);
    if (el) {
      el.remove();
    }
  }
  for (const el of document.querySelectorAll(".cn-root")) {
    el.remove();
  }
  const existingRoots = Array.from(document.querySelectorAll("#cbn-root"));
  if (existingRoots.length > 1) {
    for (const el of existingRoots.slice(1)) {
      el.remove();
    }
  }

  if (window.__cbnInjected) {
    return;
  }
  window.__cbnInjected = true;

  const STORAGE_KEY = "cbn_state";
  const DEFAULT_STATE = {
    visible: false,
    collapsed: false,
    mode: "edit",
    theme: "dark",
    position: { top: 70, right: 20 },
    activeNoteId: "note-1",
    notes: [{ id: "note-1", title: "Note 1", text: "" }]
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
          <button class="cbn-btn cbn-theme-toggle" type="button" title="Switch theme">Light</button>
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
  const themeToggleButton = root.querySelector(".cbn-theme-toggle");
  const editor = root.querySelector(".cbn-editor");
  const preview = root.querySelector(".cbn-preview");
  const editTab = root.querySelector(".cbn-edit-tab");
  const previewTab = root.querySelector(".cbn-preview-tab");
  const noteTabList = root.querySelector(".cbn-note-tab-list");
  const addNoteButton = root.querySelector(".cbn-note-add");
  const renameNoteButton = root.querySelector(".cbn-note-rename");
  const deleteNoteButton = root.querySelector(".cbn-note-delete");

  let saveTimer = null;
  let dragState = null;

  function sanitize(text) {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
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
      if (listType) {
        html.push(`</${listType}>`);
        listType = "";
      }
    };

    for (const line of lines) {
      if (line.startsWith("```")) {
        closeListIfNeeded();
        if (inCode) {
          html.push("</code></pre>");
          inCode = false;
        } else {
          html.push("<pre><code>");
          inCode = true;
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

      const ul = line.match(/^[-*]\s+(.+)/);
      if (ul) {
        if (listType !== "ul") {
          closeListIfNeeded();
          listType = "ul";
          html.push("<ul>");
        }
        html.push(`<li>${inlineMarkdown(ul[1])}</li>`);
        continue;
      }

      const ol = line.match(/^\d+\.\s+(.+)/);
      if (ol) {
        if (listType !== "ol") {
          closeListIfNeeded();
          listType = "ol";
          html.push("<ol>");
        }
        html.push(`<li>${inlineMarkdown(ol[1])}</li>`);
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

  function getActiveNote() {
    return state.notes.find((note) => note.id === state.activeNoteId) || state.notes[0] || null;
  }

  function ensureValidState() {
    if (!Array.isArray(state.notes) || state.notes.length === 0) {
      state.notes = JSON.parse(JSON.stringify(DEFAULT_STATE.notes));
      state.activeNoteId = state.notes[0].id;
    }
    if (!state.notes.some((n) => n.id === state.activeNoteId)) {
      state.activeNoteId = state.notes[0].id;
    }
    if (state.theme !== "light" && state.theme !== "dark") {
      state.theme = "dark";
    }
  }

  function saveState() {
    const active = getActiveNote();
    if (active) {
      active.text = editor.value;
    }
    chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveState, 180);
  }

  function applyTheme() {
    root.dataset.theme = state.theme;
    themeToggleButton.textContent = state.theme === "dark" ? "Light" : "Dark";
  }

  function applyPosition() {
    root.style.top = `${Math.max(0, state.position.top)}px`;
    root.style.right = `${Math.max(0, state.position.right)}px`;
  }

  function clampPosition() {
    const width = root.offsetWidth || 360;
    const safeTop = Math.max(0, Math.min(state.position.top, window.innerHeight - 52));
    const left = window.innerWidth - state.position.right - width;
    const safeLeft = Math.max(0, Math.min(left, window.innerWidth - 40));
    state.position.top = safeTop;
    state.position.right = Math.max(0, window.innerWidth - safeLeft - width);
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
    const active = getActiveNote();
    preview.innerHTML = renderMarkdown(active ? active.text : "");
  }

  function renderNoteTabs() {
    noteTabList.replaceChildren();
    for (const note of state.notes) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cbn-note-tab";
      button.dataset.noteId = note.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(note.id === state.activeNoteId));
      button.textContent = note.title || "Untitled";
      noteTabList.appendChild(button);
    }
  }

  function refreshActiveNoteUI() {
    const active = getActiveNote();
    editor.value = active ? active.text : "";
    updatePreview();
    renderNoteTabs();
  }

  function generateNoteId() {
    return `note-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  function createNote() {
    const nextNumber = state.notes.length + 1;
    const note = { id: generateNoteId(), title: `Note ${nextNumber}`, text: "" };
    state.notes.push(note);
    state.activeNoteId = note.id;
    refreshActiveNoteUI();
    saveState();
  }

  function renameActiveNote() {
    const active = getActiveNote();
    if (!active) {
      return;
    }
    const renamed = window.prompt("Rename note:", active.title);
    if (renamed === null) {
      return;
    }
    const title = renamed.trim().slice(0, 28);
    active.title = title || "Untitled";
    renderNoteTabs();
    saveState();
  }

  function deleteActiveNote() {
    if (state.notes.length <= 1) {
      window.alert("At least one note must remain.");
      return;
    }
    const active = getActiveNote();
    if (!active) {
      return;
    }
    if (!window.confirm(`Delete "${active.title}"?`)) {
      return;
    }
    state.notes = state.notes.filter((n) => n.id !== active.id);
    state.activeNoteId = state.notes[0].id;
    refreshActiveNoteUI();
    saveState();
  }

  function toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    saveState();
  }

  function loadState() {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const saved = result[STORAGE_KEY];
      if (saved && typeof saved === "object") {
        state.visible = Boolean(saved.visible);
        state.collapsed = Boolean(saved.collapsed);
        state.mode = saved.mode === "preview" ? "preview" : "edit";
        state.theme = saved.theme === "light" ? "light" : "dark";

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
            typeof saved.activeNoteId === "string" && saved.activeNoteId ? saved.activeNoteId : state.notes[0].id;
        } else {
          const migratedText = typeof saved.text === "string" ? saved.text : "";
          state.notes = [{ id: "note-1", title: "Note 1", text: migratedText }];
          state.activeNoteId = "note-1";
        }
      }

      ensureValidState();
      clampPosition();
      applyTheme();
      applyPosition();
      updateMode();
      updateCollapsed();
      updateVisibility();
      refreshActiveNoteUI();
      saveState();
    });
  }

  editor.addEventListener("input", () => {
    const active = getActiveNote();
    if (active) {
      active.text = editor.value;
    }
    updatePreview();
    scheduleSave();
  });

  noteTabList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const noteButton = target.closest(".cbn-note-tab");
    if (!noteButton) {
      return;
    }
    const noteId = noteButton.dataset.noteId;
    if (!noteId || noteId === state.activeNoteId) {
      return;
    }
    const active = getActiveNote();
    if (active) {
      active.text = editor.value;
    }
    state.activeNoteId = noteId;
    refreshActiveNoteUI();
    saveState();
  });

  addNoteButton.addEventListener("click", createNote);
  renameNoteButton.addEventListener("click", renameActiveNote);
  deleteNoteButton.addEventListener("click", deleteActiveNote);
  themeToggleButton.addEventListener("click", toggleTheme);

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

  editTab.addEventListener("click", () => {
    state.mode = "edit";
    updateMode();
    saveState();
  });

  previewTab.addEventListener("click", () => {
    state.mode = "preview";
    updatePreview();
    updateMode();
    saveState();
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
      state.visible = !state.visible;
      updateVisibility();
      saveState();
    }
  });

  loadState();
})();
(function initCollapsibleNotepad() {
  const LEGACY_ROOT_IDS = ["collapsible-notepad-root", "collapsible-notepad-root-v2"];
  for (const id of LEGACY_ROOT_IDS) {
    const el = document.getElementById(id);
    if (el) {
      el.remove();
    }
  }
  for (const el of document.querySelectorAll(".cn-root")) {
    el.remove();
  }
  const existingRoots = Array.from(document.querySelectorAll("#cbn-root"));
  if (existingRoots.length > 1) {
    for (const el of existingRoots.slice(1)) {
      el.remove();
    }
  }

  if (window.__cbnInjected) {
    return;
  }
  window.__cbnInjected = true;

  const STORAGE_KEY = "cbn_state";
  const DEFAULT_STATE = {
    visible: false,
    collapsed: false,
    mode: "edit",
    theme: "dark",
    position: { top: 70, right: 20 },
    activeNoteId: "note-1",
    notes: [{ id: "note-1", title: "Note 1", text: "" }]
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
          <button class="cbn-btn cbn-theme-toggle" type="button" title="Switch theme">Light</button>
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
  const themeToggleButton = root.querySelector(".cbn-theme-toggle");
  const editor = root.querySelector(".cbn-editor");
  const preview = root.querySelector(".cbn-preview");
  const editTab = root.querySelector(".cbn-edit-tab");
  const previewTab = root.querySelector(".cbn-preview-tab");
  const noteTabList = root.querySelector(".cbn-note-tab-list");
  const addNoteButton = root.querySelector(".cbn-note-add");
  const renameNoteButton = root.querySelector(".cbn-note-rename");
  const deleteNoteButton = root.querySelector(".cbn-note-delete");

  let saveTimer = null;
  let dragState = null;

  function sanitize(text) {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
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
      if (listType) {
        html.push(`</${listType}>`);
        listType = "";
      }
    };

    for (const line of lines) {
      if (line.startsWith("```")) {
        closeListIfNeeded();
        if (inCode) {
          html.push("</code></pre>");
          inCode = false;
        } else {
          html.push("<pre><code>");
          inCode = true;
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

      const ul = line.match(/^[-*]\s+(.+)/);
      if (ul) {
        if (listType !== "ul") {
          closeListIfNeeded();
          listType = "ul";
          html.push("<ul>");
        }
        html.push(`<li>${inlineMarkdown(ul[1])}</li>`);
        continue;
      }

      const ol = line.match(/^\d+\.\s+(.+)/);
      if (ol) {
        if (listType !== "ol") {
          closeListIfNeeded();
          listType = "ol";
          html.push("<ol>");
        }
        html.push(`<li>${inlineMarkdown(ol[1])}</li>`);
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

  function getActiveNote() {
    return state.notes.find((note) => note.id === state.activeNoteId) || state.notes[0] || null;
  }

  function ensureValidState() {
    if (!Array.isArray(state.notes) || state.notes.length === 0) {
      state.notes = JSON.parse(JSON.stringify(DEFAULT_STATE.notes));
      state.activeNoteId = state.notes[0].id;
    }
    if (!state.notes.some((n) => n.id === state.activeNoteId)) {
      state.activeNoteId = state.notes[0].id;
    }
    if (state.theme !== "light" && state.theme !== "dark") {
      state.theme = "dark";
    }
  }

  function saveState() {
    const active = getActiveNote();
    if (active) {
      active.text = editor.value;
    }
    chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveState, 180);
  }

  function applyTheme() {
    root.dataset.theme = state.theme;
    themeToggleButton.textContent = state.theme === "dark" ? "Light" : "Dark";
  }

  function applyPosition() {
    root.style.top = `${Math.max(0, state.position.top)}px`;
    root.style.right = `${Math.max(0, state.position.right)}px`;
  }

  function clampPosition() {
    const width = root.offsetWidth || 360;
    const safeTop = Math.max(0, Math.min(state.position.top, window.innerHeight - 52));
    const left = window.innerWidth - state.position.right - width;
    const safeLeft = Math.max(0, Math.min(left, window.innerWidth - 40));
    state.position.top = safeTop;
    state.position.right = Math.max(0, window.innerWidth - safeLeft - width);
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
    const active = getActiveNote();
    preview.innerHTML = renderMarkdown(active ? active.text : "");
  }

  function renderNoteTabs() {
    noteTabList.replaceChildren();
    for (const note of state.notes) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cbn-note-tab";
      button.dataset.noteId = note.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(note.id === state.activeNoteId));
      button.textContent = note.title || "Untitled";
      noteTabList.appendChild(button);
    }
  }

  function refreshActiveNoteUI() {
    const active = getActiveNote();
    editor.value = active ? active.text : "";
    updatePreview();
    renderNoteTabs();
  }

  function generateNoteId() {
    return `note-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  function createNote() {
    const nextNumber = state.notes.length + 1;
    const note = { id: generateNoteId(), title: `Note ${nextNumber}`, text: "" };
    state.notes.push(note);
    state.activeNoteId = note.id;
    refreshActiveNoteUI();
    saveState();
  }

  function renameActiveNote() {
    const active = getActiveNote();
    if (!active) {
      return;
    }
    const renamed = window.prompt("Rename note:", active.title);
    if (renamed === null) {
      return;
    }
    const title = renamed.trim().slice(0, 28);
    active.title = title || "Untitled";
    renderNoteTabs();
    saveState();
  }

  function deleteActiveNote() {
    if (state.notes.length <= 1) {
      window.alert("At least one note must remain.");
      return;
    }
    const active = getActiveNote();
    if (!active) {
      return;
    }
    if (!window.confirm(`Delete "${active.title}"?`)) {
      return;
    }
    state.notes = state.notes.filter((n) => n.id !== active.id);
    state.activeNoteId = state.notes[0].id;
    refreshActiveNoteUI();
    saveState();
  }

  function toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    saveState();
  }

  function loadState() {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const saved = result[STORAGE_KEY];
      if (saved && typeof saved === "object") {
        state.visible = Boolean(saved.visible);
        state.collapsed = Boolean(saved.collapsed);
        state.mode = saved.mode === "preview" ? "preview" : "edit";
        state.theme = saved.theme === "light" ? "light" : "dark";

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
            typeof saved.activeNoteId === "string" && saved.activeNoteId ? saved.activeNoteId : state.notes[0].id;
        } else {
          const migratedText = typeof saved.text === "string" ? saved.text : "";
          state.notes = [{ id: "note-1", title: "Note 1", text: migratedText }];
          state.activeNoteId = "note-1";
        }
      }

      ensureValidState();
      clampPosition();
      applyTheme();
      applyPosition();
      updateMode();
      updateCollapsed();
      updateVisibility();
      refreshActiveNoteUI();
      saveState();
    });
  }

  editor.addEventListener("input", () => {
    const active = getActiveNote();
    if (active) {
      active.text = editor.value;
    }
    updatePreview();
    scheduleSave();
  });

  noteTabList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const noteButton = target.closest(".cbn-note-tab");
    if (!noteButton) {
      return;
    }
    const noteId = noteButton.dataset.noteId;
    if (!noteId || noteId === state.activeNoteId) {
      return;
    }
    const active = getActiveNote();
    if (active) {
      active.text = editor.value;
    }
    state.activeNoteId = noteId;
    refreshActiveNoteUI();
    saveState();
  });

  addNoteButton.addEventListener("click", createNote);
  renameNoteButton.addEventListener("click", renameActiveNote);
  deleteNoteButton.addEventListener("click", deleteActiveNote);
  themeToggleButton.addEventListener("click", toggleTheme);

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

  editTab.addEventListener("click", () => {
    state.mode = "edit";
    updateMode();
    saveState();
  });

  previewTab.addEventListener("click", () => {
    state.mode = "preview";
    updatePreview();
    updateMode();
    saveState();
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
      state.visible = !state.visible;
      updateVisibility();
      saveState();
    }
  });

  loadState();
})();
(function initCollapsibleNotepad() {
  const LEGACY_ROOT_IDS = ["collapsible-notepad-root", "collapsible-notepad-root-v2"];
  for (const id of LEGACY_ROOT_IDS) {
    const el = document.getElementById(id);
    if (el) {
      el.remove();
    }
  }
  for (const el of document.querySelectorAll(".cn-root")) {
    el.remove();
  }
  const existingRoots = Array.from(document.querySelectorAll("#cbn-root"));
  if (existingRoots.length > 1) {
    for (const el of existingRoots.slice(1)) {
      el.remove();
    }
  }

  if (window.__cbnInjected) {
    return;
  }
  window.__cbnInjected = true;

  const STORAGE_KEY = "cbn_state";
  const DEFAULT_STATE = {
    visible: false,
    collapsed: false,
    mode: "edit",
    theme: "dark",
    position: { top: 70, right: 20 },
    activeNoteId: "note-1",
    notes: [{ id: "note-1", title: "Note 1", text: "" }]
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
          <button class="cbn-btn cbn-theme-toggle" type="button" title="Switch theme">Light</button>
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
  const themeToggleButton = root.querySelector(".cbn-theme-toggle");
  const editor = root.querySelector(".cbn-editor");
  const preview = root.querySelector(".cbn-preview");
  const editTab = root.querySelector(".cbn-edit-tab");
  const previewTab = root.querySelector(".cbn-preview-tab");
  const noteTabList = root.querySelector(".cbn-note-tab-list");
  const addNoteButton = root.querySelector(".cbn-note-add");
  const renameNoteButton = root.querySelector(".cbn-note-rename");
  const deleteNoteButton = root.querySelector(".cbn-note-delete");

  let saveTimer = null;
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
        if (inCode) {
          html.push("</code></pre>");
          inCode = false;
        } else {
          html.push("<pre><code>");
          inCode = true;
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

      const ul = line.match(/^[-*]\s+(.+)/);
      if (ul) {
        if (listType !== "ul") {
          closeListIfNeeded();
          listType = "ul";
          html.push("<ul>");
        }
        html.push(`<li>${inlineMarkdown(ul[1])}</li>`);
        continue;
      }

      const ol = line.match(/^\d+\.\s+(.+)/);
      if (ol) {
        if (listType !== "ol") {
          closeListIfNeeded();
          listType = "ol";
          html.push("<ol>");
        }
        html.push(`<li>${inlineMarkdown(ol[1])}</li>`);
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

  function getActiveNote() {
    return state.notes.find((note) => note.id === state.activeNoteId) || state.notes[0] || null;
  }

  function ensureValidState() {
    if (!Array.isArray(state.notes) || state.notes.length === 0) {
      state.notes = JSON.parse(JSON.stringify(DEFAULT_STATE.notes));
      state.activeNoteId = state.notes[0].id;
    }
    if (!state.notes.some((n) => n.id === state.activeNoteId)) {
      state.activeNoteId = state.notes[0].id;
    }
    if (state.theme !== "light" && state.theme !== "dark") {
      state.theme = "dark";
    }
  }

  function saveState() {
    const active = getActiveNote();
    if (active) {
      active.text = editor.value;
    }
    chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveState, 180);
  }

  function applyTheme() {
    root.dataset.theme = state.theme;
    themeToggleButton.textContent = state.theme === "dark" ? "Light" : "Dark";
  }

  function applyPosition() {
    root.style.top = `${Math.max(0, state.position.top)}px`;
    root.style.right = `${Math.max(0, state.position.right)}px`;
  }

  function clampPosition() {
    const width = root.offsetWidth || 360;
    const safeTop = Math.max(0, Math.min(state.position.top, window.innerHeight - 52));
    const left = window.innerWidth - state.position.right - width;
    const safeLeft = Math.max(0, Math.min(left, window.innerWidth - 40));
    state.position.top = safeTop;
    state.position.right = Math.max(0, window.innerWidth - safeLeft - width);
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
    const active = getActiveNote();
    preview.innerHTML = renderMarkdown(active ? active.text : "");
  }

  function renderNoteTabs() {
    noteTabList.replaceChildren();
    for (const note of state.notes) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cbn-note-tab";
      button.dataset.noteId = note.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(note.id === state.activeNoteId));
      button.textContent = note.title || "Untitled";
      noteTabList.appendChild(button);
    }
  }

  function refreshActiveNoteUI() {
    const active = getActiveNote();
    editor.value = active ? active.text : "";
    updatePreview();
    renderNoteTabs();
  }

  function generateNoteId() {
    return `note-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  function createNote() {
    const nextNumber = state.notes.length + 1;
    const note = { id: generateNoteId(), title: `Note ${nextNumber}`, text: "" };
    state.notes.push(note);
    state.activeNoteId = note.id;
    refreshActiveNoteUI();
    saveState();
  }

  function renameActiveNote() {
    const active = getActiveNote();
    if (!active) {
      return;
    }
    const renamed = window.prompt("Rename note:", active.title);
    if (renamed === null) {
      return;
    }
    const title = renamed.trim().slice(0, 28);
    active.title = title || "Untitled";
    renderNoteTabs();
    saveState();
  }

  function deleteActiveNote() {
    if (state.notes.length <= 1) {
      window.alert("At least one note must remain.");
      return;
    }
    const active = getActiveNote();
    if (!active) {
      return;
    }
    if (!window.confirm(`Delete "${active.title}"?`)) {
      return;
    }
    state.notes = state.notes.filter((n) => n.id !== active.id);
    state.activeNoteId = state.notes[0].id;
    refreshActiveNoteUI();
    saveState();
  }

  function toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    saveState();
  }

  function loadState() {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const saved = result[STORAGE_KEY];
      if (saved && typeof saved === "object") {
        state.visible = Boolean(saved.visible);
        state.collapsed = Boolean(saved.collapsed);
        state.mode = saved.mode === "preview" ? "preview" : "edit";
        state.theme = saved.theme === "light" ? "light" : "dark";

        if (saved.position && Number.isFinite(saved.position.top) && Number.isFinite(saved.position.right)) {
          state.position = {
            top: saved.position.top,
            right: saved.position.right
          };
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
            typeof saved.activeNoteId === "string" && saved.activeNoteId ? saved.activeNoteId : state.notes[0].id;
        } else {
          const migratedText = typeof saved.text === "string" ? saved.text : "";
          state.notes = [{ id: "note-1", title: "Note 1", text: migratedText }];
          state.activeNoteId = "note-1";
        }
      }

      ensureValidState();
      clampPosition();
      applyTheme();
      applyPosition();
      updateMode();
      updateCollapsed();
      updateVisibility();
      refreshActiveNoteUI();
      saveState();
    });
  }

  editor.addEventListener("input", () => {
    const active = getActiveNote();
    if (active) {
      active.text = editor.value;
    }
    updatePreview();
    scheduleSave();
  });

  noteTabList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const noteButton = target.closest(".cbn-note-tab");
    if (!noteButton) {
      return;
    }
    const noteId = noteButton.dataset.noteId;
    if (!noteId || noteId === state.activeNoteId) {
      return;
    }
    const active = getActiveNote();
    if (active) {
      active.text = editor.value;
    }
    state.activeNoteId = noteId;
    refreshActiveNoteUI();
    saveState();
  });

  addNoteButton.addEventListener("click", createNote);
  renameNoteButton.addEventListener("click", renameActiveNote);
  deleteNoteButton.addEventListener("click", deleteActiveNote);
  themeToggleButton.addEventListener("click", toggleTheme);

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

  editTab.addEventListener("click", () => {
    state.mode = "edit";
    updateMode();
    saveState();
  });

  previewTab.addEventListener("click", () => {
    state.mode = "preview";
    updatePreview();
    updateMode();
    saveState();
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
      state.visible = !state.visible;
      updateVisibility();
      saveState();
    }
  });

  loadState();
})();
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
