// Monaco Editor setup
require(['vs/editor/editor.main'], function() {
  // Define theme first
  monaco.editor.defineTheme('SoftDark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
      { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
      { token: 'string', foreground: 'CE9178' },
      { token: 'number', foreground: 'B5CEA8' },
    ],
    colors: {
      'editor.background': '#000000',
      'editor.lineHighlightBackground': '#111111',
      'editorCursor.foreground': '#FFFFFF',
    }
  });

  // Variables
  let editor;
  let tabs = new Map();
  let activeTabId = null;
  let untitledCounter = 1;
  let closedTabsStack = [];
  let currentProcessId = null;

  // DOM elements
  const tabList = document.getElementById('tab-list');
  const newTabButton = document.getElementById('new-tab-button');
  const runButton = document.getElementById('run-button');
  const openButton = document.getElementById('open-file-button');
  const saveButton = document.getElementById('save-file-button');
  const saveAsButton = document.getElementById('save-as-button');
  const stopButton = document.getElementById('stop-button');
  const clearButton = document.getElementById('clear-console-button');
  const findReplaceButton = document.getElementById('find-replace-button');
  const snippetsButton = document.getElementById('snippets-button');
  const bookmarksButton = document.getElementById('bookmarks-button');
  const todoButton = document.getElementById('todo-button');
  const historyButton = document.getElementById('history-button');
  const panelTabs = document.querySelectorAll('.panel-tab-button');
  const searchInput = document.getElementById('search-input');
  const searchButton = document.getElementById('search-button');
  const searchResultsContainer = document.getElementById('search-results-container');
  const outputConsole = document.getElementById('output-console');
  const consoleInput = document.getElementById('console-input');
  const lineColStatus = document.getElementById('line-col-status');
  const filePathStatus = document.getElementById('file-path-status');
  const charCountStatus = document.getElementById('char-count-status');
  const formatCodeButton = document.getElementById('format-code-button');
  const gotoLineButton = document.getElementById('goto-line-button');
  const togglePanelButton = document.getElementById('toggle-panel-button');
  const snippetsModal = document.getElementById('snippets-modal');
  const dropOverlay = document.getElementById('drop-overlay');
  const verticalResizer = document.getElementById('resizer');
  const outputPanel = document.getElementById('output-panel');

  // Web API wrapper (replaces Electron API) - теперь внутри, чтобы иметь доступ к переменным
  const WebAPI = {
    async runCode(code) {
      if (!code || typeof code !== 'string') {
        addConsoleLine('\n[ОШИБКА]: Код не может быть пустым\n', 'error');
        return;
      }
      
      const input = consoleInput ? consoleInput.textContent.trim() : '';
      
      try {
        const requestBody = { code, input };
        console.log('Sending request:', { codeLength: code.length, hasInput: !!input });
        
        const response = await fetch('/api/compile-and-run', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch (e) {
            errorData = { error: errorText || `HTTP error! status: ${response.status}` };
          }
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
          addConsoleLine(`\n[ОШИБКА КОМПИЛЯЦИИ]\n${result.error}\n`, 'error');
          if (result.markers && result.markers.length > 0) {
            updateCompilationMarkers(result.markers);
          }
          if (stopButton) stopButton.disabled = true;
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
        if (stopButton) stopButton.disabled = true;
      } catch (error) {
        addConsoleLine(`\n[ОШИБКА]: ${error.message}\n`, 'error');
        if (stopButton) stopButton.disabled = true;
      }
    },
    
    async stopProcess() {
      // В веб-версии процесс завершится автоматически по таймауту
      if (stopButton) stopButton.disabled = true;
    },
    
    async openFile() {
      return new Promise((resolve) => {
        const input = document.getElementById('file-input');
        if (!input) {
          resolve([]);
          return;
        }
        input.onchange = async (e) => {
          const files = Array.from(e.target.files);
          const fileContents = [];
          for (const file of files) {
            try {
              const content = await file.text();
              fileContents.push({ filePath: file.name, content });
            } catch (err) {
              console.error('Error reading file:', err);
            }
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
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return 'code.cpp';
    },
    
    async saveFile(filePath, content) {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filePath;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
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

  // Helper functions
  function addConsoleLine(text, type = 'log') {
    if (!outputConsole) return;
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    line.textContent = text;
    outputConsole.appendChild(line);
    outputConsole.scrollTop = outputConsole.scrollHeight;
  }

  function updateStatusBar() {
    if (!editor || !activeTabId || !tabs.has(activeTabId)) return;
    const position = editor.getPosition();
    if (position && lineColStatus) {
      lineColStatus.textContent = `Ln ${position.lineNumber}, Col ${position.column}`;
    }
    const tabData = tabs.get(activeTabId);
    if (filePathStatus) {
      filePathStatus.textContent = tabData.filePath || tabData.tabNameElement.textContent;
    }
    const text = editor.getValue();
    if (charCountStatus) {
      charCountStatus.textContent = `${text.length} chars, ${editor.getModel().getLineCount()} lines`;
    }
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
    if (tabList) tabList.appendChild(tabElement);
    switchToTab(id);
  }

  function switchToTab(id) {
    if (!tabs.has(id) || !editor) return;
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
        createNewTab(null, '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}');
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

  function executeSearch() {
    if (!searchResultsContainer || !searchInput) return;
    const searchTerm = searchInput.value;
    if (!searchTerm || tabs.size === 0) {
      searchResultsContainer.innerHTML = '<span style="color: #888;">Enter a search query...</span>';
      return;
    }
    searchResultsContainer.innerHTML = '';
    let totalMatches = 0;
    for (const tabData of tabs.values()) {
      const model = tabData.model;
      const matches = model.findMatches(searchTerm, false, false, false, null, true);
      if (matches.length > 0) {
        totalMatches += matches.length;
        const groupEl = document.createElement('div');
        groupEl.className = 'search-result-group';
        const headerEl = document.createElement('h4');
        headerEl.textContent = `${tabData.tabNameElement.textContent} (${matches.length} matches)`;
        groupEl.appendChild(headerEl);
        for (const match of matches) {
          const itemEl = document.createElement('div');
          itemEl.className = 'search-result-item';
          const lineNum = match.range.startLineNumber;
          const lineContent = model.getLineContent(lineNum);
          const highlightedText = lineContent.replace(
            new RegExp(searchTerm.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi'),
            (m) => `<mark>${m}</mark>`
          );
          itemEl.innerHTML = `
            <span class="result-line-number">${lineNum}:</span>
            <span class="result-line-text">${highlightedText.trim()}</span>
          `;
          itemEl.addEventListener('click', () => {
            switchToTab(tabData.id);
            editor.revealLineInCenter(lineNum);
            editor.setSelection(match.range);
            editor.focus();
          });
          groupEl.appendChild(itemEl);
        }
        searchResultsContainer.appendChild(groupEl);
      }
    }
    if (totalMatches === 0) {
      searchResultsContainer.innerHTML = `<span style="color: #888;">No matches found for "${searchTerm}".</span>`;
    }
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
  if (runButton) {
    runButton.addEventListener('click', async () => {
      if (!editor || !activeTabId) return;
      const code = editor.getValue();
      if (outputConsole) outputConsole.innerHTML = '';
      addConsoleLine('Compiling...\n', 'status');
      if (consoleInput) {
        consoleInput.contentEditable = true;
        consoleInput.textContent = '';
      }
      if (stopButton) stopButton.disabled = false;
      await WebAPI.runCode(code);
    });
  }

  if (stopButton) {
    stopButton.addEventListener('click', () => {
      WebAPI.stopProcess();
    });
  }

  if (clearButton) {
    clearButton.addEventListener('click', () => {
      if (outputConsole) outputConsole.innerHTML = '';
      addConsoleLine('Console cleared.\n', 'status');
    });
  }

  if (openButton) {
    openButton.addEventListener('click', async () => {
      const files = await WebAPI.openFile();
      for (const file of files) {
        createNewTab(file.filePath, file.content);
      }
    });
  }

  if (saveButton) {
    saveButton.addEventListener('click', () => {
      if (activeTabId) saveTab(activeTabId);
    });
  }

  if (saveAsButton) {
    saveAsButton.addEventListener('click', () => {
      if (activeTabId) saveTab(activeTabId, true);
    });
  }

  if (newTabButton) {
    newTabButton.addEventListener('click', () => {
      createNewTab(null, '// New file\n\n');
    });
  }

  if (findReplaceButton) {
    findReplaceButton.addEventListener('click', () => {
      if (editor) {
        editor.getAction('actions.startFindReplaceAction').run();
      }
    });
  }

  if (panelTabs && panelTabs.length > 0) {
    panelTabs.forEach(tabButton => {
      tabButton.addEventListener('click', () => {
        panelTabs.forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.panel-pane').forEach(pane => pane.classList.remove('active'));
        const panelName = tabButton.dataset.panel;
        tabButton.classList.add('active');
        const pane = document.getElementById(`${panelName}-pane`);
        if (pane) pane.classList.add('active');
        if (panelName === 'search' && searchInput) {
          searchInput.focus();
        }
      });
    });
  }

  if (searchButton) {
    searchButton.addEventListener('click', executeSearch);
  }

  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        executeSearch();
      }
    });
  }

  if (formatCodeButton) {
    formatCodeButton.addEventListener('click', () => {
      if (editor) {
        editor.getAction('editor.action.formatDocument').run();
      }
    });
  }

  if (gotoLineButton) {
    gotoLineButton.addEventListener('click', () => {
      if (editor) {
        editor.getAction('actions.gotoLine').run();
      }
    });
  }

  if (togglePanelButton) {
    togglePanelButton.addEventListener('click', () => {
      if (outputPanel) outputPanel.classList.toggle('panel-hidden');
      if (verticalResizer) verticalResizer.classList.toggle('panel-hidden');
      if (togglePanelButton) togglePanelButton.classList.toggle('active');
      if (editor) editor.layout();
    });
  }

  // Snippets
  const snippetTemplates = {
    'hello-world': `#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}`,
    'input-output': `#include <iostream>\nusing namespace std;\n\nint main() {\n    int number;\n    cout << "Enter a number: ";\n    cin >> number;\n    cout << "You entered: " << number << endl;\n    return 0;\n}`,
    'vector': `#include <iostream>\n#include <vector>\nusing namespace std;\n\nint main() {\n    vector<int> numbers = {1, 2, 3, 4, 5};\n    \n    for (int num : numbers) {\n        cout << num << " ";\n    }\n    cout << endl;\n    return 0;\n}`,
  };

  if (snippetsModal) {
    const snippetCards = snippetsModal.querySelectorAll('.snippet-card');
    snippetCards.forEach(card => {
      card.addEventListener('click', () => {
        const snippetType = card.dataset.snippet;
        if (snippetTemplates[snippetType]) {
          createNewTab(null, snippetTemplates[snippetType]);
          snippetsModal.classList.remove('active');
        }
      });
    });

    const modalClose = snippetsModal.querySelector('.modal-close');
    if (modalClose) {
      modalClose.addEventListener('click', () => {
        snippetsModal.classList.remove('active');
      });
    }
  }

  if (snippetsButton) {
    snippetsButton.addEventListener('click', () => {
      if (snippetsModal) snippetsModal.classList.add('active');
    });
  }

  // Drag and drop
  if (dropOverlay) {
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer.types.includes('Files')) {
        dropOverlay.classList.add('active');
      }
    });

    window.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) {
        dropOverlay.classList.remove('active');
      }
    });

    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropOverlay.classList.remove('active');
      if (!e.dataTransfer.files) return;
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        if (file.name.match(/\.(cpp|c|h|hpp|txt|md)$/i)) {
          try {
            const content = await file.text();
            createNewTab(file.name, content);
          } catch (err) {
            console.error('Error reading file:', err);
          }
        }
      }
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'r') {
      e.preventDefault();
      if (runButton) runButton.click();
    }
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      if (saveButton) saveButton.click();
    }
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      if (saveAsButton) saveAsButton.click();
    }
    if (e.ctrlKey && e.key === 'o') {
      e.preventDefault();
      if (openButton) openButton.click();
    }
    if (e.ctrlKey && e.key === 't') {
      e.preventDefault();
      if (newTabButton) newTabButton.click();
    }
    if (e.ctrlKey && e.key === 'h') {
      e.preventDefault();
      if (findReplaceButton) findReplaceButton.click();
    }
  });

  // Resizer
  if (verticalResizer) {
    let isResizing = false;
    verticalResizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      e.preventDefault();
      document.body.style.cursor = 'row-resize';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const titlebar = document.querySelector('.titlebar');
      const titlebarHeight = titlebar ? titlebar.offsetHeight : 40;
      const resizerHeight = verticalResizer.offsetHeight;
      const editorPanelHeight = e.clientY - titlebarHeight;
      const minOutputHeight = 100;
      const outputPanelHeight = window.innerHeight - e.clientY - resizerHeight;
      const editorPanel = document.getElementById('editor-panel');
      
      if (editorPanelHeight < 100 || outputPanelHeight < minOutputHeight) return;
      if (editorPanel) editorPanel.style.flexBasis = editorPanelHeight + 'px';
      if (outputPanel) outputPanel.style.flexBasis = outputPanelHeight + 'px';
      if (editor) editor.layout();
    });

    document.addEventListener('mouseup', () => {
      isResizing = false;
      document.body.style.cursor = 'default';
    });
  }

  // Bookmarks, TODO, History (заглушки)
  if (bookmarksButton) {
    bookmarksButton.addEventListener('click', () => {
      alert('Bookmarks feature coming soon!');
    });
  }

  if (todoButton) {
    todoButton.addEventListener('click', () => {
      alert('TODO feature coming soon!');
    });
  }

  if (historyButton) {
    historyButton.addEventListener('click', () => {
      alert('Build history feature coming soon!');
    });
  }

  // Create initial tab
  createNewTab(null, '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}');

  console.log('✅ C++ IDE Web Version loaded successfully!');
});

