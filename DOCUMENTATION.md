# Mineral Segmentation - Полная документация проекта

## 1. Обзор проекта

**Mineral Segmentation** — это десктопное приложение для сегментации и аннотации минеральных зерен по изображениям поляризованной микроскопии.

### 1.1 Назначение

Приложение позволяет:
- Загружать 4 изображения шлифа при разных настройках поляризации
- Автоматически выравнивать изображения относительно друг друга
- Сегментировать изображение на отдельные минеральные зерна
- Размечать сегменты тегами минералов
- Сохранять результаты сегментации

### 1.2 Технологический стек

| Компонент | Технология |
|-----------|------------|
| Frontend | Electron + React 18 (embedded в HTML) |
| Backend | FastAPI + Python 3.x |
| Компьютерное зрение | OpenCV, scikit-image |
| Сегментация | SLIC/QuickShift + RAG merging (CIEDE2000) |

---

## 2. Архитектура приложения

### 2.1 Структура директорий

```
minseg/
├── backend/
│   ├── main.py           # FastAPI сервер, API endpoints
│   ├── aligner.py        # Выравнивание изображений (ORB + Homography)
│   ├── segmentation.py   # Алгоритмы сегментации
│   └── requirements.txt  # Python зависимости
│
├── frontend/
│   ├── main.js          # Electron main process
│   ├── preload.js       # IPC bridge (безопасное API для renderer)
│   ├── public/
│   │   ├── index.html   # Страница загрузки изображений
│   │   └── app.html     # Редактор сегментации (React)
│   └── src/
│       ├── app.js       # React компоненты (не используется напрямую)
│       └── styles/
│           └── main.css # Стили приложения
│
├── start.bat            # Скрипт запуска (Windows)
├── build.bat            # Скрипт сборки
└── README.md            # Краткое описание
```

### 2.2 Жизненный цикл приложения

```
1. Запуск Electron (main.js)
   └─→ Запуск Python backend на порту 8001
   └─→ Создание BrowserWindow
   └─→ Загрузка index.html

2. Загрузка изображений (index.html)
   └─→ Пользователь выбирает 4 файла
   └─→ Загрузка на сервер через /api/load-image
   └─→ Выравнивание через /api/align-images
   └─→ Запуск сегментации в фоне через /api/start-segmentation
   └─→ Переход в app.html (редактор)

3. Редактирование (app.html)
   └─→ Отображение текущего патча 1024×1024
   └─→ Опрос статуса сегментации каждые 500мс
   └─→ Пользователь размечает сегменты
   └─→ Сохранение проекта через /api/save-project
```

---

## 3. Backend (Python/FastAPI)

### 3.1 Глобальное состояние (AppState)

```python
class AppState:
    images: Dict[str, np.ndarray]           # Оригинальные изображения
    aligned_images: Dict[str, np.ndarray]   # Выровненные изображения
    patches: Dict[str, Dict[Tuple, np.ndarray]]  # Патчи 1024×1024
    segmentations: Dict[Tuple, dict]        # Результаты сегментации
    labels: Dict[Tuple, np.ndarray]         # Метки сегментов
    patch_size: int = 1024
    grid_size: Tuple[int, int]              # (rows, cols)
    tag_colors: Dict[str, str]              # tag_name -> color_hex
    is_segmenting: bool
```

### 3.2 API Endpoints

| Endpoint | Method | Описание |
|----------|--------|----------|
| `/` | GET | Проверка сервера |
| `/api/load-image` | POST | Загрузка одного изображения |
| `/api/load-images` | POST | Загрузка всех 4 изображений |
| `/api/align-images` | POST | Выравнивание изображений |
| `/api/start-segmentation` | POST | Запуск фоновой сегментации |
| `/api/segment-patch/{py}/{px}` | POST | Приоритетная сегментация патча |
| `/api/segmentation-progress` | GET | Прогресс сегментации |
| `/api/patch/{py}/{px}` | GET | Получение изображения патча |
| `/api/segmentation/{py}/{px}` | GET | Результаты сегментации патча |
| `/api/label-segment` | POST | Присвоение тега сегменту |
| `/api/tags` | GET | Получение всех тегов |
| `/api/save-project` | POST | Сохранение проекта |
| `/api/minimap` | GET | Мини-карта всего изображения |

### 3.3 Модуль aligner.py

#### Класс Aligner

Выравнивание изображений с использованием ORB-детектора и гомографии.

**Методы:**

1. `align(reference_img, target_img) -> np.ndarray`
   - Выравнивает `target_img` к `reference_img`
   - Использует ORB для обнаружения ключевых точек
   - Находит гомографию методом RANSAC
   - Возвращает выровненное изображение

2. `align_as(target_img, reference_for_target, final_reference) -> np.ndarray`
   - Двухэтапное выравнивание
   - **КРИТИЧЕСКАЯ ОШИБКА**: см. раздел 5

### 3.4 Модуль segmentation.py

#### Основные функции:

1. `denoise(img)` —降噪 (mean shift filtering + inpainting)
2. `segment_patch(img, thresh)` — Первичная сегментация (QuickShift/SLIC)
3. `process_mask(mask_img, pixels)` — Обработка маски границ (watershed)
4. `full_segmentation(xpl90, xpl45, thresh)` — Полная сегментация

#### Алгоритм сегментации:

```
1. Denoise: pyrMeanShiftFiltering + Laplacian + Inpainting
2. Initial segmentation: QuickShift (kernel=3, max_dist=30)
3. Build RAG: rag_mean_color в LAB пространстве
4. Hierarchical merging: merge_hierarchical с CIEDE2000
5. Process boundaries: dilate → thinning → watershed
```

---

## 4. Frontend (Electron/React)

### 4.1 Две HTML-страницы

**index.html** — Страница загрузки:
- Выбор 4 файлов изображений
- Отображение прогресса загрузки
- Переход в редактор после выравнивания

**app.html** — Редактор:
- React-приложение (embedded в HTML)
- Отображение патчей с навигацией
- Наложение сегментов/границ
- Модальное окно аннотации

### 4.2 IPC (Inter-Process Communication)

**preload.js** экспортирует в `window.electronAPI`:

```javascript
{
  selectSingleImage: () => Promise<{canceled, filePath, fileName}>,
  selectImages: () => Promise<{canceled, ppl45, ppl90, xpl45, xpl90}>,
  selectOutputFolder: () => Promise<{canceled, path}>,
  getApiUrl: () => Promise<string>,
  readFileBuffer: (path) => {data, size},
  openEditor: () => Promise<{success}>,
  isAvailable: true
}
```

### 4.3 Горячие клавиши

| Клавиша | Действие |
|---------|----------|
| X | Переключить XPL 45°/90° |
| P | Переключить PPL/XPL |
| S | Показать сегменты |
| B | Показать границы |
| ←→↑↓ | Навигация по патчам |

---

## 5. КРИТИЧЕСКАЯ ОШИБКА ВЫРАВНИВАНИЯ

### 5.1 Описание проблемы

При выравнивании изображений возникает эффект "выворачивания наизнанку" — изображение выглядит искажённым, с неправильными пропорциями.

### 5.2 Правильная последовательность выравнивания

Согласно эталонному файлу `segmentation_E2000.py`:

```python
# Шаг 1: Выравнивание XPL45 к PPL45 (одинаковый угол 45°)
img_xpl45 = aligner.align(img_ppl45, img_xpl45)

# Шаг 2: Выравнивание XPL90 к PPL90 (одинаковый угол 90°)
img_xpl90 = aligner.align(img_ppl90, img_xpl90)

# Шаг 3: Преобразование XPL90 в координаты PPL45
# XPL90 уже выровнен к PPL90, нужно применить трансформацию PPL90→PPL45
img_xpl90 = aligner.align_as(img_xpl90, img_ppl90, img_ppl45)

# Шаг 4: Выравнивание PPL90 к PPL45
img_ppl90 = aligner.align(img_ppl45, img_ppl90)
```

### 5.3 Корневая причина ошибки

**Функция `align_as` содержит ошибку:**

```python
def align_as(self, target_img, reference_for_target, final_reference):
    # ОШИБКА: Повторное выравнивание уже выровненного изображения!
    aligned_to_direct = self.align(reference_for_target, target_img)
    # ... rest of code
```

Когда вызывается `aligner.align_as(img_xpl90, img_ppl90, img_ppl45)`:
- `target_img` = `img_xpl90` — **уже выровнен к PPL90**
- Функция пытается **повторно** выровнять его к PPL90
- Это вызывает искажение изображения

### 5.4 Решение

Функция `align_as` должна:
1. НЕ повторять выравнивание (target уже выровнен к reference_for_target)
2. Найти гомографию от reference_for_target к final_reference
3. Применить эту гомографию к target_img

**Исправленный код:**

```python
def align_as(self, target_img: np.ndarray, reference_for_target: np.ndarray, 
             final_reference: np.ndarray) -> np.ndarray:
    """
    Преобразует target_img (уже выровненный к reference_for_target)
    в координатное пространство final_reference.
    
    Args:
        target_img: Изображение, УЖЕ выровненное к reference_for_target
        reference_for_target: Референс для target (например, ppl90)
        final_reference: Финальный референс (например, ppl45)
    """
    # Найти гомографию от reference_for_target к final_reference
    ref_gray = cv2.cvtColor(final_reference, cv2.COLOR_BGR2GRAY)
    target_gray = cv2.cvtColor(reference_for_target, cv2.COLOR_BGR2GRAY)
    
    keypoints1, descriptors1 = self.orb.detectAndCompute(target_gray, None)
    keypoints2, descriptors2 = self.orb.detectAndCompute(ref_gray, None)
    
    if descriptors1 is None or descriptors2 is None or len(descriptors1) < 2 or len(descriptors2) < 2:
        return target_img  # Не можем найти трансформацию
    
    matches = list(self.matcher.match(descriptors1, descriptors2, None))
    
    if len(matches) < 4:
        return target_img
    
    matches.sort(key=lambda x: x.distance, reverse=False)
    num_good_matches = max(int(len(matches) * self.good_match_percent), 4)
    matches = matches[:num_good_matches]
    
    points1 = np.zeros((len(matches), 2), dtype=np.float32)
    points2 = np.zeros((len(matches), 2), dtype=np.float32)
    
    for i, match in enumerate(matches):
        points1[i, :] = keypoints1[match.queryIdx].pt
        points2[i, :] = keypoints2[match.trainIdx].pt
    
    h, mask = cv2.findHomography(points1, points2, cv2.RANSAC)
    
    if h is None:
        return target_img
    
    # Применить гомографию НАПРЯМУЮ к target_img (без повторного выравнивания!)
    height, width = final_reference.shape[:2]
    result = cv2.warpPerspective(target_img, h, (width, height))
    
    return result
```

---

## 6. Типы изображений

### 6.1 Обозначения

| Код | Полное название | Описание |
|-----|-----------------|----------|
| PPL | Plane Polarized Light | Параллельный николь |
| XPL | Cross Polarized Light | Скрещенный николь |
| 45 | 45° | Угол положения столика |
| 90 | 90° | Угол положения столика |

### 6.2 Зачем нужны 4 изображения?

Разные минералы по-разному выглядят при разных настройках:
- PPL — цвет, прозрачность, форма
- XPL — интерференционные цвета, двойникование
- Разные углы — изменение оптических свойств при вращении

---

## 7. Выходные данные

### 7.1 Структура сохранения проекта

```
output_folder/
├── tags.json                    # Теги и их цвета
├── segmented_full.png           # Полная сегментированная карта
├── ppl45_aligned.png            # Выровненные изображения
├── ppl90_aligned.png
├── xpl45_aligned.png
├── xpl90_aligned.png
├── patches_segmented/           # Сегментированные патчи
│   ├── patch_000_000.png
│   └── ...
├── patches_ppl45/               # Оригинальные патчи
├── patches_ppl90/
├── patches_xpl45/
├── patches_xpl90/
└── annotations/                 # JSON аннотации
    ├── patch_000_000.json
    └── ...
```

---

## 8. Диагностика проблем

### 8.1 Backend не запускается

```bash
# Проверить Python и зависимости
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8001
```

### 8.2 Изображения не загружаются

- Проверить размер файлов (должны быть разумного размера)
- Проверить формат (jpg, png, tiff)
- Проверить консоль браузера (DevTools)

### 8.3 Выравнивание некорректно

- Убедиться, что изображения соответствуют типам (ppl45, ppl90, xpl45, xpl90)
- Проверить, что изображения сделаны с одного шлифа
- Проверить исправление в разделе 5

---

## 9. История изменений

### v1.1 (текущая версия)
- Добавлена параллельная сегментация (редактор открывается сразу)
- Добавлен endpoint `/api/segment-patch/{py}/{px}` для приоритетной сегментации
- **ИСПРАВЛЕНО**: Ошибка выравнивания в `align_as` (раздел 5)

### v1.0
- Базовая функциональность
- Сегментация с ожиданием 100%
