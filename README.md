# Mineral Segmentation

Десктопное приложение для автоматической сегментации и разметки минеральных зёрен на изображениях поляризованной микроскопии.

## Функционал

### Загрузка и обработка
- Загрузка 4 изображений: PPL 45°, PPL 90°, XPL 45°, XPL 90°
- Автоматическое выравнивание (ORB + ECC patch voting)
- Разбиение на патчи 1024x1024
- Фоновая сегментация с прогрессом (до 4 потоков)

### Сегментация
1. Денойзинг: Mean Shift фильтрация + инпейнтинг мелких деталей
2. Первоначальная сегментация: QuickShift
3. Построение RAG с весами CIEDE2000
4. Иерархическое слияние регионов по порогу Delta E
5. Комбинирование результатов XPL 45° и XPL 90°
6. Watershed + connected components для чистых границ

### Просмотр и навигация
- Многослойный canvas: изображение, сегменты, границы, выделение
- Minimap с состоянием патчей (готов / обрабатывается / в очереди)
- Масштабирование и панорамирование
- Переключение между режимами поляризации

### Разметка
- Дерево тегов (Tag → Patch → Segment) в боковой панели
- Inline quick-input для назначения тегов с автокомплитом
- Мультивыделение сегментов (Shift/Ctrl+клик в дереве)
- Пакетная разметка и снятие тегов
- Контекстное меню: переименование, перекраска, удаление тегов
- Undo/Redo для всех операций (Ctrl+Z / Ctrl+Y, до 200 операций)

### Экспорт
- PNG патчи для каждого типа поляризации + сегменты
- JSON с маппингом тегов и цветов

## Системные требования

| Компонент | Требование |
|-----------|-----------|
| ОС | Windows 10+, Linux |
| Python | 3.14 |
| Node.js | 18+ |
| RAM | 8 ГБ (рекомендуется 16 ГБ) |
| Диск | ~2 ГБ |

## Запуск (разработка)

```bash
# Backend
cd backend
uv sync
uv run python -m uvicorn main:app --reload --port 8001

# Frontend (в другом терминале)
cd frontend
npm install
npm start
```

Или на Windows: `start.bat`

## Сборка

### Linux
```bash
# Требуется: uv, node, gcc, patchelf, ccache (опционально)
./build.sh
# Результат: frontend/dist/*.AppImage
```

### Windows
```batch
:: Требуется: python, node, MSVC Build Tools
build.bat
:: Результат: frontend\dist\*.exe
```

### Пайплайн сборки (5 шагов)
1. **Nuitka** — компиляция Python → C → нативный бинарник
2. **npm install** — зависимости фронтенда
3. **bytenode** — компиляция main.js в V8 bytecode
4. **javascript-obfuscator** — обфускация renderer
5. **electron-builder** — упаковка в AppImage / NSIS installer

## Структура проекта

```
├── backend/
│   ├── main.py              # FastAPI сервер, 30+ эндпоинтов
│   ├── segmentation.py      # QuickShift + RAG + Watershed
│   ├── aligner.py           # ORB + ECC выравнивание
│   ├── undo.py              # Command Pattern undo/redo
│   ├── tests/               # pytest + pytest-asyncio
│   ├── pyproject.toml
│   └── requirements.txt
│
├── frontend/
│   ├── main.js              # Electron main process
│   ├── preload.js            # IPC bridge
│   ├── public/
│   │   ├── index.html        # Загрузка изображений
│   │   └── app.html          # Редактор
│   ├── src/
│   │   ├── app-bundle.js     # React UI (production)
│   │   ├── app.js            # React UI (development)
│   │   └── styles/main.css
│   └── package.json
│
├── build.sh                  # Сборка Linux
├── build.bat                 # Сборка Windows
└── start.bat                 # Запуск для разработки (Windows)
```

## Горячие клавиши

| Клавиша | Действие |
|---------|----------|
| X | Переключить XPL 45° / XPL 90° |
| P | Переключить XPL / PPL режим |
| S | Показать/скрыть сегменты |
| B | Показать/скрыть границы |
| Ctrl+Z | Отменить |
| Ctrl+Y | Повторить |
| Esc | Закрыть quick-input |
| Enter | Подтвердить quick-input |
| Стрелки | Навигация по патчам |
| Ctrl+O | Загрузить изображения |
| Ctrl+S | Сохранить проект |
| Колесо мыши | Масштабирование |
| ПКМ + перетаскивание | Панорамирование |

## Тесты

```bash
cd backend
uv run python -m pytest tests/ -v        # Все тесты
uv run python -m pytest tests/ --cov=.   # С покрытием
```

## Технологии

**Backend:** Python 3.14, FastAPI, OpenCV, scikit-image, NumPy, SciPy

**Frontend:** Electron 33, React 18, Canvas API

**Сборка:** Nuitka, bytenode, javascript-obfuscator, electron-builder

**Тесты:** pytest, pytest-asyncio, httpx
