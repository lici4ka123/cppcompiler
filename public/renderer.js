// Web API wrapper (replaces Electron API)
const WebAPI = {
  async runCode(code) {
    const input = consoleInput.textContent.trim();
    try {
      const response = await fetch('/api/compile-and-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, input })
      });
      
      const result = await response.json();
      
      if (!result.success) {
        addConsoleLine(`\n[ОШИБКА КОМПИЛЯЦИИ]\n${result.error}\n`, 'error');
        if (result.markers && result.markers.length > 0) {
          updateCompilationMarkers(result.markers);
        }
        stopButton.disabled = true;
        return;
      }
      
      if (result.output) {
        addConsoleLine(result.output, 'log');
      }
      if (result.error) {
        addConsoleLine(result.error, 'error');
      }
      if (result.exitCode !== undefined) {
        addConsoleLine(`\n[Процесс завершен с кодом ${result.exitCode}]\n`, 'status');
      }
      stopButton.disabled = true;
    } catch (error) {
      addConsoleLine(`\n[ОШИБКА]: ${error.message}\n`, 'error');
      stopButton.disabled = true;
    }
  },
  
  async stopProcess() {
    // В веб-версии процесс уже завершится сам
    stopButton.disabled = true;
  },
  
  async openFile() {
    return new Promise((resolve) => {
      const input = document.getElementById('file-input');
      input.onchange = async (e) => {
        const files = Array.from(e.target.files);
        const fileContents = [];
        for (const file of files) {
          const content = await file.text();
          fileContents.push({ filePath: file.name, content });
        }
        input.value = '';
        resolve(fileContents);
      };
      input.click();
    });
  },
  
  async saveFileAs(content) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'code.cpp';
    a.click();
    URL.revokeObjectURL(url);
    return 'code.cpp'; // Возвращаем имя файла
  },
  
  async saveFile(filePath, content) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filePath;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  },
  
  showUnsavedTabDialog(fileName) {
    return new Promise((resolve) => {
      const result = confirm(`Вы хотите сохранить изменения в файле "${fileName}"?`);
      if (result) {
        resolve('save');
      } else {
        resolve('dontsave');
      }
    });
  }
};

// Monaco Editor setup
require(['vs/editor/editor.main'], function() {
  monaco.editor.defineTheme('SoftDark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
      { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
      { token: 'string', foreground: 'CE9178' },
    ],
    colors: {
      'editor.background': '#000000',
      'editor.lineHighlightBackground': '#111111',
    }
  });

  let editor;
  let tabs = new Map();
  let activeTabId = null;
  let untitledCounter = 1;

  // DOM elements
  const tabList = document.getElementById('tab-list');
  const newTabButton = document.getElementById('new-tab-button');
  const runButton = document.getElementById('run-button');
  const openButton = document.getElementById('open-file-button');
  const saveButton = document.getElementById('save-file-button');
  const saveAsButton = document.getElementById('save-as-button');
  const stopButton = document.getElementById('stop-button');
  const clearButton = document.getElementById('clear-console-button');
  const outputConsole = document.getElementById('output-console');
  const consoleInput = document.getElementById('console-input');
  const lineColStatus = document.getElementById('line-col-status');
  const filePathStatus = document.getElementById('file-path-status');
  const charCountStatus = document.getElementById('char-count-status');

  // Helper functions
  function addConsoleLine(text, type = 'log') {
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    line.textContent = text;
    outputConsole.appendChild(line);
    outputConsole.scrollTop = outputConsole.scrollHeight;
  }

  function updateStatusBar() {
    if (!editor || !activeTabId || !tabs.has(activeTabId)) return;
    const position = editor.getPosition();
    if (position) {
      lineColStatus.textContent = `Ln ${position.lineNumber}, Col ${position.column}`;
    }
    const tabData = tabs.get(activeTabId);
    filePathStatus.textContent = tabData.filePath || tabData.tabNameElement.textContent;
    const text = editor.getValue();
    charCountStatus.textContent = `${text.length} chars, ${editor.getModel().getLineCount()} lines`;
  }

  function createNewTab(filePath = null, content = '') {
    if (filePath) {
      const existingTab = Array.from(tabs.values()).find(tab => tab.filePath === filePath);
      if (existingTab) {
        switchToTab(existingTab.id);
        return;
      }
    }
    const id = `tab_${Date.now()}_${Math.random()}`;
    const model = monaco.editor.createModel(content, 'cpp');
    const tabElement = document.createElement('li');
    tabElement.className = 'tab-item';
    tabElement.dataset.tabId = id;
    const tabName = document.createElement('span');
    tabName.className = 'tab-name';
    const closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.innerHTML = '&times;';
    tabElement.appendChild(tabName);
    tabElement.appendChild(closeBtn);
    const tabData = {
      id, model, filePath,
      isDirty: false, tabElement, tabNameElement: tabName
    };
    tabs.set(id, tabData);
    updateTabName(id);
    model.onDidChangeContent(() => {
      if (!tabData.isDirty) {
        tabData.isDirty = true;
        tabElement.classList.add('dirty');
      }
    });
    tabElement.addEventListener('click', () => switchToTab(id));
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(id);
    });
    tabList.appendChild(tabElement);
    switchToTab(id);
  }

  function switchToTab(id) {
    if (!tabs.has(id)) return;
    if (activeTabId && tabs.has(activeTabId)) {
      tabs.get(activeTabId).tabElement.classList.remove('active');
    }
    const tabData = tabs.get(id);
    tabData.tabElement.classList.add('active');
    editor.setModel(tabData.model);
    activeTabId = id;
    editor.focus();
    updateStatusBar();
  }

  function updateTabName(id) {
    if (!tabs.has(id)) return;
    const tabData = tabs.get(id);
    const name = tabData.filePath ? tabData.filePath.split(/[\\/]/).pop() : `Untitled-${untitledCounter++}`;
    tabData.tabNameElement.textContent = name;
  }

  async function closeTab(id) {
    if (!tabs.has(id)) return;
    const tabData = tabs.get(id);
    if (tabData.isDirty) {
      const fileName = tabData.tabNameElement.textContent;
      const result = await WebAPI.showUnsavedTabDialog(fileName);
      if (result === 'save') {
        await saveTab(id);
      }
    }
    tabData.tabElement.remove();
    tabData.model.dispose();
    tabs.delete(id);
    if (activeTabId === id) {
      if (tabs.size > 0) {
        switchToTab(Array.from(tabs.keys())[0]);
      } else {
        createNewTab(null, '#include <iostream>\n\nint main() {\n    \n    return 0;\n}');
      }
    }
  }

  async function saveTab(id, forceSaveAs = false) {
    if (!tabs.has(id)) return false;
    const tabData = tabs.get(id);
    const content = tabData.model.getValue();
    if (!tabData.filePath || forceSaveAs) {
      const newPath = await WebAPI.saveFileAs(content);
      if (newPath) {
        tabData.filePath = newPath;
        tabData.isDirty = false;
        tabData.tabElement.classList.remove('dirty');
        updateTabName(id);
        return true;
      }
      return false;
    } else {
      await WebAPI.saveFile(tabData.filePath, content);
      tabData.isDirty = false;
      tabData.tabElement.classList.remove('dirty');
      return true;
    }
  }

  function updateCompilationMarkers(markers) {
    if (!editor || !activeTabId) return;
    const model = editor.getModel();
    const monacoMarkers = markers.map(m => ({
      startLineNumber: m.line,
      startColumn: m.col,
      endLineNumber: m.line,
      endColumn: m.col + 1,
      message: m.message,
      severity: m.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning
    }));
    monaco.editor.setModelMarkers(model, 'compiler', monacoMarkers);
  }

  // Initialize editor
  editor = monaco.editor.create(document.getElementById('editor-container'), {
    language: 'cpp',
    theme: 'SoftDark',
    automaticLayout: true,
    fontFamily: "'JetBrains Mono', Consolas, monospace",
    fontSize: 15,
    wordWrap: 'on',
    minimap: { enabled: true },
  });

  editor.onDidChangeCursorPosition(() => updateStatusBar());
  editor.onDidChangeModelContent(() => updateStatusBar());

  // Event listeners
  runButton.addEventListener('click', async () => {
    if (!editor || !activeTabId) return;
    const code = editor.getValue();
    outputConsole.innerHTML = '';
    addConsoleLine('Compiling...\n', 'status');
    consoleInput.contentEditable = true;
    consoleInput.textContent = '';
    stopButton.disabled = false;
    await WebAPI.runCode(code);
  });

  stopButton.addEventListener('click', () => {
    WebAPI.stopProcess();
  });

  clearButton.addEventListener('click', () => {
    outputConsole.innerHTML = '';
    addConsoleLine('Console cleared.\n', 'status');
  });

  openButton.addEventListener('click', async () => {
    const files = await WebAPI.openFile();
    for (const file of files) {
      createNewTab(file.filePath, file.content);
    }
  });

  saveButton.addEventListener('click', () => {
    if (activeTabId) saveTab(activeTabId);
  });

  saveAsButton.addEventListener('click', () => {
    if (activeTabId) saveTab(activeTabId, true);
  });

  newTabButton.addEventListener('click', () => {
    createNewTab(null, '// New file\n\n');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'r') {
      e.preventDefault();
      runButton.click();
    }
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveButton.click();
    }
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      saveAsButton.click();
    }
    if (e.ctrlKey && e.key === 'o') {
      e.preventDefault();
      openButton.click();
    }
  });

  // Create initial tab
  createNewTab(null, '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}');

  console.log('✅ C++ IDE Web Version loaded successfully!');
});

