# C++ IDE - Web Version

Веб-версия C++ IDE с возможностью компиляции и запуска C++ кода прямо в браузере.

## Возможности

- ✅ Редактирование C++ кода с подсветкой синтаксиса (Monaco Editor)
- ✅ Компиляция C++ кода на сервере
- ✅ Запуск скомпилированных программ
- ✅ Множественные вкладки
- ✅ Открытие и сохранение файлов
- ✅ Консоль для вывода программ
- ✅ Поиск по коду
- ✅ Настройки редактора

## Требования

- Node.js 14+ 
- G++ компилятор (установленный на сервере)
  - Linux: `sudo apt-get install g++`
  - macOS: `brew install gcc` или через Xcode
  - Windows: MinGW или MSYS2

## Установка и запуск

1. Установите зависимости:
```bash
cd web-version
npm install
```

2. Убедитесь, что G++ установлен:
```bash
g++ --version
```

3. Запустите сервер:
```bash
npm start
```

4. Откройте браузер и перейдите на `http://localhost:3000`

## Развертывание на бесплатных хостингах

### 1. Render.com (Рекомендуется)

1. Создайте аккаунт на [render.com](https://render.com)
2. Создайте новый "Web Service"
3. Подключите ваш GitHub репозиторий
4. Настройки:
   - **Build Command**: `cd web-version && npm install`
   - **Start Command**: `cd web-version && npm start`
   - **Environment**: `Node`
5. Добавьте переменную окружения:
   - `PORT`: `10000` (или оставьте пустым, Render установит автоматически)

**Важно**: Render.com поддерживает установку пакетов через Buildpack. Убедитесь, что у вас есть `apt-get` доступ для установки G++.

### 2. Railway.app

1. Создайте аккаунт на [railway.app](https://railway.app)
2. Нажмите "New Project" → "Deploy from GitHub repo"
3. Выберите репозиторий
4. Railway автоматически определит Node.js проект
5. В настройках проекта добавьте:
   - Build Command: `cd web-version && npm install`
   - Start Command: `cd web-version && npm start`

Railway автоматически установит G++ через buildpack.

### 3. Fly.io

1. Установите flyctl: https://fly.io/docs/getting-started/installing-flyctl/
2. Создайте аккаунт: `fly auth signup`
3. В папке `web-version` создайте `Dockerfile`:
```dockerfile
FROM node:18

# Install G++
RUN apt-get update && apt-get install -y g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
```

4. Деплой:
```bash
cd web-version
fly launch
fly deploy
```

### 4. Heroku

1. Установите Heroku CLI: https://devcenter.heroku.com/articles/heroku-cli
2. Создайте аккаунт на [heroku.com](https://heroku.com)
3. В папке `web-version` создайте файлы:

**`Procfile`**:
```
web: npm start
```

**`.buildpacks`** (если нужен):
```
heroku/nodejs
https://github.com/heroku/heroku-buildpack-apt
```

**`Aptfile`** (для установки G++):
```
g++
```

4. Деплой:
```bash
cd web-version
heroku create your-app-name
heroku buildpacks:add heroku/nodejs
heroku buildpacks:add https://github.com/heroku/heroku-buildpack-apt
git push heroku main
```

### 5. Replit

1. Создайте аккаунт на [replit.com](https://replit.com)
2. Создайте новый Repl → "Import from GitHub"
3. Выберите репозиторий
4. В `.replit` файле:
```toml
run = "cd web-version && npm start"
```

Replit автоматически установит зависимости и G++.

## Структура проекта

```
web-version/
├── server.js          # Express сервер с API для компиляции
├── package.json       # Зависимости Node.js
├── public/            # Статические файлы
│   ├── index.html     # Главная страница
│   ├── renderer.js    # Фронтенд логика
│   ├── styles.css     # Стили
│   └── vs/            # Monaco Editor
└── README.md          # Эта документация
```

## API Endpoints

- `POST /api/compile-and-run` - Компиляция и запуск кода
  - Body: `{ code: string, input?: string }`
  - Response: `{ success: boolean, output?: string, error?: string, markers?: Array }`

- `GET /api/health` - Проверка состояния сервера

## Безопасность

⚠️ **Важно**: Этот сервер запускает произвольный C++ код на сервере. В продакшене рекомендуется:

- Добавить ограничения по времени выполнения
- Ограничить размер входного кода
- Добавить rate limiting
- Использовать изоляцию (Docker, sandbox)
- Ограничить ресурсы (CPU, память, диск)

## Ограничения

- Максимальное время выполнения программы: 30 секунд
- Временные файлы автоматически удаляются через 1 час
- Только один процесс компиляции/запуска одновременно на пользователя

## Лицензия

ISC

## Поддержка

Если у вас возникли проблемы:
1. Проверьте, что G++ установлен: `g++ --version`
2. Проверьте логи сервера
3. Убедитесь, что порт не занят другим приложением
