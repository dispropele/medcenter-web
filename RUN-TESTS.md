# МедЦентр - Инструкция по запуску тестов

## Быстрый старт

1. **Установите зависимости:**
   ```bash
   npm install
   ```

2. **Запустите все тесты:**
   ```bash
   npm test
   ```

3. **Просмотрите отчет о покрытии:**
   ```bash
   npm run test:coverage
   ```

## Доступные команды

```bash
# Запустить все тесты один раз
npm test

# Запустить тесты в режиме наблюдения (автопрезагрузка при изменениях)
npm run test:watch

# Получить отчет о покрытии кода
npm run test:coverage

# Запустить конкретный файл с тестами
npm test -- auth.test.js

# Запустить только тесты авторизации
npm test -- --testNamePattern="Authentication"

# Запустить с подробным выводом
npm test -- --verbose

# Запустить с отладкой
node --inspect-brk node_modules/.bin/jest --runInBand
```

## Структура тестов

```
tests/
├── auth.test.js          # Тесты аутентификации и регистрации
├── appointments.test.js   # Тесты записей к врачу
├── contracts.test.js      # Тесты договоров
├── receipts.test.js       # Тесты квитанций
├── checks.test.js         # Тесты чеков об оплате
├── admin.test.js          # Тесты администрирования
├── reports.test.js        # Тесты отчетов
├── medical-card.test.js   # Тесты медкарты пациента
```

## Что покрывают тесты

### 1. Аутентификация (auth.test.js) - 10 тестов
- ✅ Вход пациента, администратора
- ✅ Регистрация и валидация данных
- ✅ Защита и логаут

### 2. Записи к врачу (appointments.test.js) - 8 тестов
- ✅ Просмотр по ролям
- ✅ Создание записей
- ✅ Изменение статусов
- ✅ Получение врачей по специализации

### 3. Договоры (contracts.test.js) - 6 тестов
- ✅ Просмотр договоров
- ✅ Создание договоров
- ✅ Получение деталей

### 4. Квитанции (receipts.test.js) - 6 тестов
- ✅ Управление квитанциями
- ✅ Добавление услуг
- ✅ Смена статусов

### 5. Чеки (checks.test.js) - 5 тестов
- ✅ Создание чеков
- ✅ Разные методы оплаты
- ✅ Автообновление статуса

### 6. Администрирование (admin.test.js) - 12 тестов
- ✅ Управление специализациями
- ✅ Управление услугами
- ✅ Просмотр пользователей

### 7. Отчеты (reports.test.js) - 5 тестов
- ✅ Фильтрация по датам
- ✅ Типы отчетов
- ✅ Форматирование данных

### 8. Медкарта (medical-card.test.js) - 10 тестов
- ✅ Просмотр медкарты
- ✅ Редактирование посещений
- ✅ Управление диагнозами

**Всего: 62 теста**

## Пример работы тестов

### Первый запуск:
```bash
$ npm test

 PASS  tests/auth.test.js
  Authentication Tests
    ✓ GET /login - should render login page (123ms)
    ✓ POST /login - should fail with wrong credentials (89ms)
    ✓ POST /login - should login admin user (156ms)
    ✓ POST /login - should login patient user (145ms)
    ✓ GET /register - should render register page (76ms)
    ✓ POST /register - should fail with short name (92ms)
    ✓ POST /register - should successfully register new user (234ms)
    ✓ GET /dashboard - should require authentication (45ms)
    ✓ GET /logout - should destroy session (178ms)

 PASS  tests/appointments.test.js
  Appointments Tests
    ✓ GET /appointments - patient should see only their appointments (89ms)
    ✓ GET /appointments - admin should see all appointments (76ms)
    ✓ POST /appointments - patient should create appointment (145ms)
    ...

Test Suites: 8 passed, 8 total
Tests:       62 passed, 62 total
Time:        24.567s
```

## Режим наблюдения (Watch Mode)

Для разработки используйте режим наблюдения:
```bash
npm run test:watch
```

Этот режим:
- Автоматически перезапускает тесты при сохранении файлов
- Показывает только измененные тесты
- Позволяет нажать `a` для запуска всех тестов
- Позволяет нажать `p` для фильтрации по имени файла
- Позволяет нажать `t` для фильтрации по имени теста

## Отчет о покрытии

```bash
npm run test:coverage
```

Покрытие показывает:
- **Statements** - строки, которые были выполнены
- **Branches** - условия (if/else), которые были проверены
- **Functions** - функции, которые были вызваны
- **Lines** - строки кода

Целевой уровень покрытия: **70%+**

## Интеграция с CI/CD

Для GitHub Actions используйте:

```yaml
# .github/workflows/tests.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '16'
      - run: npm install
      - run: npm test
      - run: npm run test:coverage
```

## Отладка тестов

### Запустить один тест:
```bash
npm test -- --testNamePattern="should login admin"
```

### Запустить один файл с тестами:
```bash
npm test auth.test.js
```

### Запустить с debug:
```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

Затем откройте `chrome://inspect` в Chrome.

## Особенности

- ✅ **Изолированные тесты** - каждый тест работает независимо
- ✅ **Быстрые** - все 62 теста выполняются за ~25 секунд
- ✅ **Надежные** - используют реальную БД (SQL.js)
- ✅ **Полные** - покрывают все основные функции приложения
- ✅ **Актуальные** - проверяют реальный код приложения

## Решение проблем

| Проблема | Решение |
|----------|---------|
| Тесты зависают | Используйте `npm test -- --forceExit` |
| Не находит тесты | Убедитесь, файлы в папке `tests/` с суффиксом `.test.js` |
| Ошибки импорта | Запустите `npm install` |
| Не работает watch | Используйте `npm install` и повторите |

## Дополнительная информация

- Все тестовые данные создаются автоматически в БД
- Тесты используют реальное приложение Express
- Каждый тест имеет полную HTTP сессию
- Поддерживаются разные роли: admin, doctor, patient

## Контакт

При возникновении вопросов или проблем с тестами создайте issue в репозитории.
