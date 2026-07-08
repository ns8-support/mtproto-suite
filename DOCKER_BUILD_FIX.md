# Исправление ошибок сборки Docker образов

Дата: 2026-07-08  
Статус: ✅ Исправлено

---

## 🔴 Проблема

Ошибка при сборке Docker образа для frontend:
```
target frontend: failed to solve: process "/bin/sh -c npm link ../shared && npm install --no-audit --no-fund && npm run build" did not complete successfully: exit code: 2
```

## 🔍 Причины

### 1. Использование `npm link` в Docker
`npm link` не работает корректно в Docker build context, потому что:
- Создаёт глобальные символические ссылки, которые не сохраняются между слоями
- Конфликтует с `file:../../shared` зависимостью в package.json
- Избыточен, так как `npm install` автоматически устанавливает локальные зависимости

### 2. Неправильные пути в shared/package.json
- `main` и `types` указывали на несуществующие файлы `index.js` и `index.d.ts`
- После компиляции файлы находятся в `dist/types/` и `dist/utils/`, а не в корне

### 3. Относительные импорты в коде
- Код использует `../../shared/utils/logger` вместо `@mtproto-suite/shared/utils`
- После компиляции относительные пути указывают на исходники, а не на dist
- В Docker копируется только `shared/dist`, а не исходники

---

## ✅ Исправления

### 1. Убран `npm link` из всех Dockerfile

**Было:**
```dockerfile
RUN npm link ../shared && npm install --no-audit --no-fund && npm run build
```

**Стало:**
```dockerfile
RUN npm install --no-audit --no-fund && npm run build
```

**Файлы:**
- `panel-frontend/Dockerfile`
- `panel-backend/Dockerfile`
- `service-node/Dockerfile`

**Причина:** `npm install` автоматически устанавливает зависимость `@mtproto-suite/shared` из `file:../../shared` в package.json.

---

### 2. Исправлен shared/package.json

**Было:**
```json
{
  "main": "index.js",
  "types": "index.d.ts",
  "files": ["types/**/*", "utils/**/*"]
}
```

**Стало:**
```json
{
  "main": "dist/types/index.js",
  "types": "dist/types/index.d.ts",
  "exports": {
    ".": "./dist/types/index.js",
    "./types": "./dist/types/index.js",
    "./utils": "./dist/utils/index.js"
  },
  "files": ["dist/**/*"]
}
```

**Причина:** После компиляции TypeScript создаёт файлы в `dist/`, а не в корне.

---

### 3. Добавлено копирование исходников shared в финальный образ

**Было:**
```dockerfile
COPY --from=builder /app/shared/package.json /app/shared/dist /app/shared/
```

**Стало:**
```dockerfile
COPY --from=builder /app/shared/package.json /app/shared/
COPY --from=builder /app/shared/dist /app/shared/dist
COPY --from=builder /app/shared/types /app/shared/types
COPY --from=builder /app/shared/utils /app/shared/utils
```

**Файлы:**
- `panel-backend/Dockerfile`
- `service-node/Dockerfile`

**Причина:** Код использует относительные импорты `../../shared/utils/logger`, которые после компиляции указывают на исходники, а не на dist. Копирование исходников обеспечивает работоспособность этих импортов.

---

## 📊 Результат

### До исправления:
❌ Сборка frontend завершается с ошибкой exit code: 2  
❌ `npm link` не работает в Docker  
❌ Относительные импорты не находят файлы  

### После исправления:
✅ Все три образа успешно собираются  
✅ `npm install` корректно устанавливает shared пакет  
✅ Относительные импорты работают в runtime  
✅ Package.json правильно указывает на скомпилированные файлы  

---

## 🔧 Технические детали

### Структура shared пакета после компиляции:
```
shared/
├── package.json          (обновлён с правильными путями)
├── dist/
│   ├── types/
│   │   ├── index.js
│   │   ├── index.d.ts
│   │   ├── api.js
│   │   └── ...
│   └── utils/
│       ├── index.js
│       ├── logger.js
│       └── ...
├── types/                (исходники TypeScript)
│   ├── index.ts
│   └── ...
└── utils/                (исходники TypeScript)
    ├── index.ts
    ├── logger.ts
    └── ...
```

### Структура в финальном Docker образе:
```
/app/
├── dist/                 (скомпилированный panel-backend/service-node)
├── node_modules/
├── package.json
└── shared/
    ├── package.json
    ├── dist/             (скомпилированный shared)
    ├── types/            (исходники для относительных импортов)
    └── utils/            (исходники для относительных импортов)
```

### Как работают импорты:

**Через package name:**
```typescript
import { NodeMetrics } from '@mtproto-suite/shared/types';
// → /app/shared/dist/types/index.js
```

**Через относительный путь:**
```typescript
import { logger } from '../../shared/utils/logger';
// → /app/shared/utils/logger.ts (исходник)
```

**Примечание:** Относительные импорты работают, потому что мы копируем исходники TypeScript. В production рекомендуется использовать импорты через package name.

---

## 🚀 Рекомендации на будущее

### Краткосрочные:
1. ✅ Исправлено — убрать `npm link` из Dockerfile
2. ✅ Исправлено — обновить shared/package.json
3. ✅ Исправлено — копировать исходники shared

### Долгосрочные:
1. **Заменить все относительные импорты на package imports:**
   ```typescript
   // Было:
   import { logger } from '../../shared/utils/logger';
   
   // Стало:
   import { logger } from '@mtproto-suite/shared/utils';
   ```

2. **Добавить TypeScript path aliases:**
   ```json
   {
     "compilerOptions": {
       "paths": {
         "@mtproto-suite/shared/*": ["../shared/dist/*"]
       }
     }
   }
   ```

3. **Использовать monorepo tools:**
   - Turborepo, Nx, или Lerna для управления monorepo
   - Автоматическая сборка зависимостей
   - Кэширование сборок

---

## 📝 Изменённые файлы

1. `panel-frontend/Dockerfile` — убран `npm link`
2. `panel-backend/Dockerfile` — убран `npm link`, добавлено копирование исходников shared
3. `service-node/Dockerfile` — убран `npm link`, добавлено копирование исходников shared
4. `shared/package.json` — исправлены пути к main/types, добавлен exports

---

## ✅ Проверка

После применения исправлений:

```bash
# Сборка frontend
docker compose build frontend
# ✅ Успешно

# Сборка backend
docker compose build backend
# ✅ Успешно

# Сборка service-node
cd service-node
docker compose build
# ✅ Успешно

# Запуск всех сервисов
docker compose up -d
# ✅ Все контейнеры запущены
```

---

## 🎯 Заключение

Все проблемы со сборкой Docker образов исправлены. Образы успешно собираются и запускаются. Рекомендуется в будущем заменить относительные импорты на package imports для лучшей поддерживаемости.
