const express = require('express');
const cors = require('cors');
const { spawn, exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
// Обработка ошибок парсинга JSON
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error('JSON Parse Error:', err.message);
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Временная директория для компиляции
const tempDir = path.join(os.tmpdir(), 'cppcomp_web');
if (!require('fs').existsSync(tempDir)) {
  require('fs').mkdirSync(tempDir, { recursive: true });
}

// Определение пути к компилятору
function getCompilerPath() {
  const platform = os.platform();
  
  if (platform === 'win32') {
    // Для Windows проверяем локальный компилятор
    const localCompiler = path.resolve(__dirname, '..', 'compiler', 'bin', 'g++.exe');
    if (require('fs').existsSync(localCompiler)) {
      console.log(`Using local compiler: ${localCompiler}`);
      return localCompiler;
    }
    // Также проверяем в папке web-version/compiler (для деплоя)
    const webVersionCompiler = path.resolve(__dirname, 'compiler', 'bin', 'g++.exe');
    if (require('fs').existsSync(webVersionCompiler)) {
      console.log(`Using web-version compiler: ${webVersionCompiler}`);
      return webVersionCompiler;
    }
    // Если локального нет, пробуем системный
    return 'g++';
  } else if (platform === 'linux') {
    // Для Linux проверяем локальный компилятор
    const localCompiler = path.join(__dirname, '..', 'compiler', 'bin', 'g++');
    if (require('fs').existsSync(localCompiler)) {
      return localCompiler;
    }
    // Также проверяем в папке web-version/compiler (для деплоя)
    const webVersionCompiler = path.join(__dirname, 'compiler', 'bin', 'g++');
    if (require('fs').existsSync(webVersionCompiler)) {
      return webVersionCompiler;
    }
    // Пробуем системный
    return 'g++';
  } else if (platform === 'darwin') {
    // Для macOS
    const localCompiler = path.join(__dirname, '..', 'compiler', 'bin', 'g++');
    if (require('fs').existsSync(localCompiler)) {
      return localCompiler;
    }
    const webVersionCompiler = path.join(__dirname, 'compiler', 'bin', 'g++');
    if (require('fs').existsSync(webVersionCompiler)) {
      return webVersionCompiler;
    }
    return 'g++';
  }
  return 'g++'; // По умолчанию
}

const gppPath = getCompilerPath();

// Для Windows: добавляем путь к DLL в PATH для локального компилятора
// Для Linux/macOS: добавляем путь к библиотекам
if (gppPath.includes('compiler')) {
  const compilerBinDir = path.dirname(gppPath);
  const currentPath = process.env.PATH || '';
  const normalizedBinDir = compilerBinDir.replace(/\\/g, path.sep);
  if (!currentPath.includes(normalizedBinDir) && !currentPath.includes(compilerBinDir)) {
    process.env.PATH = compilerBinDir + path.delimiter + currentPath;
    if (os.platform() === 'win32') {
      console.log(`Added to PATH: ${compilerBinDir}`);
    }
  }
  if (os.platform() === 'win32') {
    console.log(`Compiler bin directory: ${compilerBinDir}`);
  }
}

// Очистка старых файлов
async function cleanupOldFiles() {
  try {
    const files = await fs.readdir(tempDir);
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const stats = await fs.stat(filePath);
      // Удаляем файлы старше 1 часа
      if (now - stats.mtime.getTime() > 3600000) {
        try {
          await fs.unlink(filePath);
        } catch (e) {
          // Игнорируем ошибки удаления
        }
      }
    }
  } catch (e) {
    // Игнорируем ошибки
  }
}

// Запускаем очистку каждые 30 минут
setInterval(cleanupOldFiles, 1800000);

// Хранение активных процессов
const activeProcesses = new Map();

// API для компиляции и запуска
app.post('/api/compile', async (req, res) => {
  const { code } = req.body;
  
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Code is required' });
  }

  const uniqueId = `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const cppFile = path.join(tempDir, `${uniqueId}.cpp`);
  const exeFile = path.join(tempDir, `${uniqueId}${os.platform() === 'win32' ? '.exe' : ''}`);
  
  try {
    // Сохраняем код в файл
    await fs.writeFile(cppFile, code, 'utf-8');
    
    // Компилируем
    const compileCommand = `"${gppPath}" "${cppFile}" -o "${exeFile}" -std=c++17 -O0 -Wall`;
    
    exec(compileCommand, { timeout: 30000 }, async (error, stdout, stderr) => {
      if (error) {
        // Парсинг ошибок компиляции
        const errorRegex = new RegExp(path.basename(cppFile) + ':(\\d+):(\\d+):\\s+(error|warning):\\s+(.*)', 'g');
        const markers = [];
        let match;
        
        while ((match = errorRegex.exec(stderr)) !== null) {
          markers.push({
            line: parseInt(match[1]),
            col: parseInt(match[2]),
            severity: match[3],
            message: match[4]
          });
        }
        
        // Очистка
        try {
          await fs.unlink(cppFile);
        } catch (e) {}
        
        return res.status(400).json({
          success: false,
          error: stderr || error.message,
          markers: markers,
          stdout: stdout
        });
      }
      
      // Успешная компиляция
      res.json({
        success: true,
        executable: `${uniqueId}${os.platform() === 'win32' ? '.exe' : ''}`,
        message: 'Compilation successful'
      });
    });
    
  } catch (error) {
    try {
      await fs.unlink(cppFile);
    } catch (e) {}
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API для запуска скомпилированной программы
app.post('/api/run', async (req, res) => {
  const { executable, input } = req.body;
  
  if (!executable) {
    return res.status(400).json({ error: 'Executable is required' });
  }
  
  const exeFile = path.join(tempDir, executable);
  
  // Проверяем существование файла
  try {
    await fs.access(exeFile);
  } catch (e) {
    return res.status(404).json({ error: 'Executable not found' });
  }
  
  // Запускаем программу
  const processId = `proc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const childProcess = spawn(exeFile, [], {
    cwd: tempDir,
    shell: false
  });
  
  activeProcesses.set(processId, {
    process: childProcess,
    executable: executable,
    startTime: Date.now()
  });
  
  let output = '';
  let errorOutput = '';
  
  childProcess.stdout.on('data', (data) => {
    output += data.toString();
  });
  
  childProcess.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });
  
  // Отправляем ввод, если есть
  if (input && childProcess.stdin) {
    childProcess.stdin.write(input + '\n');
    childProcess.stdin.end();
  }
  
  // Таймаут для завершения процесса
  const timeout = setTimeout(() => {
    if (!childProcess.killed) {
      childProcess.kill();
      activeProcesses.delete(processId);
      res.status(408).json({
        error: 'Process timeout',
        output: output,
        error: errorOutput
      });
    }
  }, 30000); // 30 секунд
  
  childProcess.on('close', async (code) => {
    clearTimeout(timeout);
    activeProcesses.delete(processId);
    
    // Очистка файлов через 5 секунд
    setTimeout(async () => {
      try {
        await fs.unlink(exeFile);
        const cppFile = path.join(tempDir, executable.replace(/\.exe$/, '').replace(/^run_/, 'run_') + '.cpp');
        try {
          await fs.unlink(cppFile);
        } catch (e) {}
      } catch (e) {
        // Игнорируем ошибки
      }
    }, 5000);
    
    res.json({
      success: true,
      exitCode: code,
      output: output,
      error: errorOutput
    });
  });
  
  childProcess.on('error', (error) => {
    clearTimeout(timeout);
    activeProcesses.delete(processId);
    res.status(500).json({
      success: false,
      error: error.message,
      output: output,
      errorOutput: errorOutput
    });
  });
});

// API для остановки процесса
app.post('/api/stop', (req, res) => {
  const { processId } = req.body;
  
  if (!processId || !activeProcesses.has(processId)) {
    return res.status(404).json({ error: 'Process not found' });
  }
  
  const procData = activeProcesses.get(processId);
  
  try {
    if (os.platform() === 'win32') {
      exec(`taskkill /PID ${procData.process.pid} /T /F`, (err) => {
        if (err) {
          procData.process.kill();
        }
      });
    } else {
      procData.process.kill('SIGTERM');
    }
    
    activeProcesses.delete(processId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API для компиляции и запуска в одном запросе (удобнее для фронтенда)
app.post('/api/compile-and-run', async (req, res) => {
  try {
    const { code, input } = req.body;
    
    // Логирование для отладки
    console.log('Received request:', { 
      hasCode: !!code, 
      codeType: typeof code, 
      codeLength: code ? code.length : 0,
      hasInput: !!input 
    });
    
    if (!code || typeof code !== 'string') {
      console.error('Validation failed: code is missing or not a string');
      return res.status(400).json({ 
        success: false,
        error: 'Code is required and must be a string',
        received: { hasCode: !!code, codeType: typeof code }
      });
    }

    const uniqueId = `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const cppFile = path.join(tempDir, `${uniqueId}.cpp`);
    const exeFile = path.join(tempDir, `${uniqueId}${os.platform() === 'win32' ? '.exe' : ''}`);
    
    try {
      await fs.writeFile(cppFile, code, 'utf-8');
      
      // Формируем команду компиляции с правильными путями для Windows
      const compileCommand = os.platform() === 'win32' 
        ? `"${gppPath}" "${cppFile}" -o "${exeFile}" -std=c++17 -O0 -Wall`
        : `"${gppPath}" "${cppFile}" -o "${exeFile}" -std=c++17 -O0 -Wall`;
      
      console.log('Compile command:', compileCommand);
      console.log('Compiler path:', gppPath);
      console.log('PATH:', process.env.PATH);
      
      exec(compileCommand, { 
        timeout: 30000,
        env: process.env,
        cwd: tempDir
      }, async (error, stdout, stderr) => {
        if (error) {
          const errorRegex = new RegExp(path.basename(cppFile) + ':(\\d+):(\\d+):\\s+(error|warning):\\s+(.*)', 'g');
          const markers = [];
          let match;
          
          while ((match = errorRegex.exec(stderr)) !== null) {
            markers.push({
              line: parseInt(match[1]),
              col: parseInt(match[2]),
              severity: match[3],
              message: match[4]
            });
          }
          
          try {
            await fs.unlink(cppFile);
          } catch (e) {}
          
          return res.status(400).json({
            success: false,
            error: stderr || error.message,
            markers: markers,
            stdout: stdout
          });
        }
        
        // Запускаем программу
        const childProcess = spawn(exeFile, [], {
          cwd: tempDir,
          shell: false
        });
        
        let output = '';
        let errorOutput = '';
        
        childProcess.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        childProcess.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });
        
        if (input && childProcess.stdin) {
          childProcess.stdin.write(input + '\n');
          childProcess.stdin.end();
        }
        
        const timeout = setTimeout(() => {
          if (!childProcess.killed) {
            childProcess.kill();
            res.status(408).json({
              success: false,
              error: 'Process timeout',
              output: output,
              error: errorOutput
            });
          }
        }, 30000);
        
        childProcess.on('close', async (code) => {
          clearTimeout(timeout);
          
          setTimeout(async () => {
            try {
              await fs.unlink(exeFile);
              await fs.unlink(cppFile);
            } catch (e) {}
          }, 5000);
          
          res.json({
            success: true,
            exitCode: code,
            output: output,
            error: errorOutput,
            markers: []
          });
        });
        
        childProcess.on('error', (procError) => {
          clearTimeout(timeout);
          res.status(500).json({
            success: false,
            error: procError.message,
            output: output,
            errorOutput: errorOutput
          });
        });
      });
    } catch (error) {
      console.error('Error in compile-and-run:', error);
      try {
        if (cppFile && require('fs').existsSync(cppFile)) {
          await fs.unlink(cppFile);
        }
      } catch (e) {}
      
      return res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  } catch (error) {
    console.error('Outer error in compile-and-run:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Serve index.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    compiler: gppPath,
    platform: os.platform()
  });
});

// Проверка компилятора при запуске
exec(`"${gppPath}" --version`, { timeout: 5000 }, (error, stdout, stderr) => {
  if (error) {
    console.warn('⚠️  WARNING: Compiler may not be available!');
    console.warn('   Path:', gppPath);
    console.warn('   Error:', error.message);
    console.warn('   Please install g++ or copy compiler to web-version/compiler/');
    console.warn('   See HOSTING.md for instructions');
  } else {
    console.log('✅ Compiler verified:', stdout.split('\n')[0]);
  }
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Compiler: ${gppPath}`);
  console.log(`📁 Temp directory: ${tempDir}`);
  console.log(`🌐 Open http://localhost:${PORT} in your browser`);
});

