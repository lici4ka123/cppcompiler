FROM node:18

# Установка g++ компилятора
RUN apt-get update && apt-get install -y g++ build-essential && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm install

# Копируем остальные файлы
COPY . .

# Создаем временную директорию
RUN mkdir -p /tmp/cppcomp_web

EXPOSE 3000

# Запускаем сервер
CMD ["npm", "start"]

