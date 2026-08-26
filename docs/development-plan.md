# План разработки GetGantt CLI

## 1. Назначение

Документ предназначен для инженера, который реализует первую публичную версию
GetGantt CLI. После прочтения должно быть понятно, какие изменения требуются в
GetGantt API, как устроена авторизация по персональному токену, какие команды
входят в MVP и какими проверками закрывается выпуск.

CLI решает три задачи:

- даёт человеку управлять графиком из терминала;
- даёт локальному AI-агенту стабильные команды и JSON-вывод;
- позволяет автоматизировать чтение, проверку и изменение графиков в скриптах и CI.

Текущий срез реализации уже содержит npm scaffold, PAT/API gateway, read-only
команды, mutation-команды и server-owned `--dry-run`. До production остаются
применение Prisma migration в staging/production, live smoke с тестовым
пользователем и проектом, системное credential-хранилище и публикация пакета.

## 2. Архитектурное решение

GetGantt CLI развивается в отдельном публичном репозитории и выпускается
независимо от веб-приложения. Серверная часть API, модель персональных токенов и
авторизация остаются в основном репозитории GetGantt.

```text
Пользователь или локальный AI-агент
    -> команда gantt
    -> HTTPS API https://ai.getgantt.ru/api/cli/v1
    -> Personal Access Token principal
    -> проверка прав пользователя на проект
    -> общий typed tool catalog
    -> CommandService
    -> gantt-lib и PostgreSQL
```

Границы ответственности:

- CLI отвечает за аргументы, профили, локальное хранение credentials, форматирование и exit codes;
- API отвечает за авторизацию, права, тарифные ограничения, валидацию, идемпотентность и аудит;
- CommandService остаётся единственной границей мутаций;
- gantt-lib остаётся единственным календарно-сетевым вычислительным ядром;
- MCP и CLI используют один каталог операций, но разные транспортные адаптеры.

CLI не должен:

- подключаться к базе данных;
- импортировать runtime-core или серверные сервисы;
- самостоятельно вычислять даты и каскады зависимостей;
- отправлять произвольные storage-команды в обход публичного контракта;
- пытаться исправлять неоднозначный проект или задачу без подтверждения пользователя.

## 3. Технологический стек

- Node.js 22 LTS;
- TypeScript в strict mode;
- Commander.js для команд, подкоманд, help и async actions;
- встроенный `fetch` для HTTP;
- Zod для проверки API-ответов и локальных файлов ввода;
- `node:test` для unit и integration tests;
- npm package `getgantt-cli` с исполняемой командой `gantt`;
- OpenAPI как публичный серверный контракт и источник генерируемых API-типов.

Первая поставка распространяется через npm:

```bash
npm install -g getgantt-cli
gantt --help
```

Одноразовый запуск:

```bash
npx getgantt-cli projects list
```

Standalone-бинарники не входят в MVP. Их можно добавить после стабилизации API
и статистики установок.

## 4. Авторизация по персональному токену

Да, CLI авторизуется по токену, выпускаемому пользователем в личном кабинете,
по модели Kaiten/GitHub Personal Access Token.

### 4.1 Выпуск токена

В личном кабинете появляется раздел «API-токены». Пользователь задаёт:

- название токена;
- срок действия;
- scopes;
- необязательное ограничение на выбранные проекты.

Минимальные scopes:

- `projects:read`;
- `schedule:read`;
- `schedule:write`;
- `imports:write`.

Секрет показывается ровно один раз. Формат должен позволять распознать тип
credential и найти запись без полного перебора, например:

```text
ggt_pat_<public-id>_<random-secret>
```

В базе хранятся только public ID, криптографический hash секрета, последние
четыре символа для UI, scopes, ограничения проектов, даты создания/истечения,
отзыва и последнего использования. Полный токен в базе, логах и трассах не
хранится.

Токен должен содержать не менее 256 бит криптографической случайности. Сравнение
hash выполняется constant-time. Отзыв действует немедленно.

Текущие JWT веб-сессии нельзя переиспользовать как PAT: они решают другую
задачу, привязаны к браузерной сессии и текущему проекту. Для CLI вводится
отдельный principal типа `personal_access_token`.

### 4.2 Вход в CLI

Основной сценарий:

```bash
gantt auth login
```

CLI запрашивает API URL и токен скрытым вводом. Токен не принимается обычным
аргументом команды, чтобы не попадать в shell history и список процессов.

Для CI поддерживаются:

```bash
gantt auth login --token-stdin
GETGANTT_TOKEN=... gantt projects list --json
```

Приоритет credentials:

1. `GETGANTT_TOKEN`;
2. выбранный локальный профиль;
3. интерактивный запрос только в TTY-режиме.

Локальное credential-хранилище должно иметь права только текущего пользователя:
ACL на Windows и mode `0600` на Unix. Переход на системный keychain допускается
после MVP. Конфигурация и credentials хранятся раздельно.

Команды управления:

```text
gantt auth login
gantt auth status
gantt auth logout
gantt auth profiles list
gantt auth profiles use <name>
```

`auth status` вызывает серверный endpoint `me`, поэтому проверяет не только
наличие локального секрета, но и срок, отзыв и фактические scopes.

## 5. Выбор проекта

Токен идентифицирует пользователя, а не единственный проект. Проект выбирается
отдельно и проверяется сервером при каждом запросе.

Приоритет выбора:

1. явный `--project <id-or-exact-name>`;
2. текущий проект выбранного CLI-профиля;
3. единственный доступный проект пользователя;
4. ошибка `project_required`, если выбор неоднозначен.

Команды:

```text
gantt projects list
gantt projects use <id-or-exact-name>
gantt projects current
```

Имя разрешается только при единственном точном совпадении. Для скриптов и
мутаций рекомендуется стабильный project ID. CLI никогда не выбирает похожий
проект автоматически.

Даже при явном project ID сервер вызывает project access check и проверяет
section-level права. Наличие `schedule:write` в токене не даёт права изменять
чужой или read-only проект.

## 6. Публичный CLI API

### 6.1 Общие правила

- базовый путь: `/api/cli/v1`;
- HTTPS обязателен;
- credential: `Authorization: Bearer <PAT>`;
- списки используют cursor pagination, `limit` ограничен сверху;
- все мутации требуют `Idempotency-Key`;
- optimistic concurrency использует graph version;
- успешный HTTP-статус никогда не содержит скрытую ошибку;
- каждый ответ и ошибка содержат `requestId`;
- breaking changes выпускаются только в новом path version.

Единая форма ошибки:

```json
{
  "error": {
    "code": "project_access_denied",
    "message": "Project is not available to this token",
    "details": { "projectId": "..." },
    "requestId": "req_..."
  }
}
```

### 6.2 Минимальные endpoints

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/me` | Проверить токен, пользователя и scopes |
| `GET` | `/projects` | Получить доступные проекты с cursor pagination |
| `GET` | `/projects/{id}` | Получить метаданные и текущую graph version |
| `GET` | `/projects/{id}/tasks` | Получить ограниченный срез задач |
| `GET` | `/tool-catalog` | Получить версию и публичные операции |
| `POST` | `/tool-calls` | Создать типизированный read или mutation call |

`POST /tool-calls` создаёт версионированный вызов общей операции:

```json
{
  "catalogVersion": "1",
  "projectId": "3dbd4a66-9dd8-4da1-93d2-1bfe6459a14f",
  "tool": "validate_schedule",
  "arguments": {}
}
```

Для мутаций сервер дополнительно требует `Idempotency-Key`, проверяет graph
version и возвращает authoritative receipt. В CLI API разрешён только публичный
allowlist; внутренние agent/runtime-инструменты не экспортируются автоматически.

### 6.3 Управление PAT из веб-приложения

Эти endpoints используют обычную веб-JWT авторизацию, а не сам PAT:

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/api/settings/api-tokens` | Список токенов без секретов |
| `POST` | `/api/settings/api-tokens` | Выпустить токен и один раз вернуть секрет |
| `POST` | `/api/settings/api-tokens/{id}/revoke` | Немедленно отозвать токен |

## 7. CLI-команды

### 7.1 Глобальные опции

```text
--profile <name>
--project <id-or-name>
--api-url <url>
--json
--quiet
--no-color
--timeout <ms>
```

Data output идёт в stdout, диагностика и ошибки — в stderr. `--json` отключает
интерактивные вопросы, цвет и progress-анимацию.

### 7.2 Read-only MVP

```text
gantt auth login|status|logout
gantt projects list|use|current
gantt project show
gantt tasks list
gantt tasks find <query>
gantt tasks show <task-id>
gantt schedule validate
gantt schedule slice
```

### 7.3 Mutation MVP

```text
gantt tasks create --file <json>
gantt tasks update --file <json>
gantt tasks move --file <json>
gantt tasks delete --id <task-id>
gantt schedule shift --days <n>
gantt dependencies link --from <id> --to <id> --type FS
gantt dependencies unlink --from <id> --to <id>
```

Опасные операции требуют интерактивного подтверждения. В non-interactive режиме
они требуют `--yes`. `--dry-run` должен выполняться сервером и возвращать тот же
типизированный candidate/diff, который может быть подтверждён для commit; CLI не
имитирует preview локально.

### 7.4 Exit codes

| Code | Значение |
|---|---|
| `0` | успех |
| `2` | ошибка аргументов или локального файла |
| `3` | нет/недействительный токен |
| `4` | доступ запрещён |
| `5` | ресурс не найден |
| `6` | validation error |
| `7` | version conflict |
| `8` | rate limit или временная недоступность |
| `10` | неожиданная ошибка CLI |

## 8. Этапы реализации

### Phase 0. Контракты и границы

- зафиксировать ADR об отдельном репозитории;
- определить публичный allowlist tool catalog;
- описать OpenAPI v1;
- определить стабильные error codes и receipt;
- добавить server module contracts, knowledge graph и verification plan.

Gate: OpenAPI и token threat model согласованы до реализации handlers.

### Phase 1. Personal Access Tokens на сервере

- добавить модель PAT и миграцию;
- реализовать выпуск, список и отзыв токенов;
- добавить scopes, expiry, project allowlist и last-used throttling;
- добавить PAT principal middleware;
- исключить секреты из логов и traces;
- добавить UI личного кабинета.

Gate: утёкший database dump не позволяет восстановить токены; отзыв блокирует
следующий запрос; токен не даёт доступа к чужому проекту.

### Phase 2. Read-only CLI API

- реализовать `/me`, projects, project metadata и task slice;
- добавить cursor pagination и hard limits;
- реализовать единый error envelope;
- опубликовать OpenAPI и contract tests.

Gate: два пользователя с разными проектами не видят данные друг друга.

### Phase 3. CLI scaffold и auth

- инициализировать npm package и `gantt` bin;
- реализовать config/profile/credential stores;
- добавить HTTP client, retries только для безопасных запросов и request IDs;
- реализовать auth-команды и global options;
- стабилизировать stdout/stderr и exit codes.

Gate: установка через npm работает на Windows, macOS и Linux; `--json` является
валидным JSON при успехе и ошибке.

### Phase 4. Read-only commands

- projects, project summary, task search/context и schedule validation;
- ограниченный вывод по умолчанию и cursor flags;
- shell completion;
- первые skills для локальных AI-агентов.

Gate: агент может найти проект и задачу без полного dump графика.

### Phase 5. Mutation gateway и команды

- добавить публичный `/tool-calls` allowlist;
- прокинуть `actorId=userId` и token ID в аудит;
- добавить idempotency, graph version и receipt;
- реализовать create/update/move/delete/link/shift;
- добавить server-owned dry-run и подтверждение опасных операций.

Gate: повтор запроса не создаёт дубль; version conflict не затирает параллельное
изменение; каждая успешная мутация имеет receipt и Undo reference.

### Phase 6. Импорт, экспорт и agent ergonomics

- CSV/Excel import и export;
- команды для отчётов;
- skills с безопасными сценариями чтения и изменения;
- bounded JSON output и file output;
- совместимость с CI secrets.

### Phase 7. Публичный релиз

- подписанный npm provenance/release workflow;
- changelog и semver;
- telemetry только по opt-in и без payload/token content;
- rate limits, abuse protection и incident runbook;
- документация установки, token setup и troubleshooting.

## 9. Верификация

Обязательные группы тестов:

- unit: parsing, profiles, precedence, formatting, exit codes;
- contract: CLI client против OpenAPI fixtures;
- integration: реальный test server и test database;
- auth: expiry, revoke, scopes, project restrictions, malformed token;
- isolation: пользователь A не читает и не меняет проекты B;
- idempotency: повтор mutating request имеет один эффект;
- concurrency: stale graph version возвращает conflict;
- packaging: global install и `npx` на трёх ОС;
- secret safety: token отсутствует в argv, stdout, stderr, logs и snapshots.

Для production smoke используется отдельный тестовый пользователь и проект.
Smoke не должен обращаться к пользовательским production-проектам.

## 10. Риски и нецели MVP

Риски:

- превращение внутреннего tool catalog в нестабильный публичный API;
- хранение PAT в открытом виде;
- неоднозначный выбор проекта по имени;
- повтор мутации после сетевого timeout;
- утечка больших графов в agent context;
- расхождение логики CLI и MCP.

Нецели MVP:

- встроенный LLM внутри CLI;
- прямой доступ к PostgreSQL;
- offline-редактирование графа;
- plugin system;
- standalone executable без Node.js;
- полный parity со всеми функциями веб-интерфейса.

## 11. Definition of Done первой публичной версии

- пользователь выпускает и отзывает PAT в личном кабинете;
- CLI устанавливается через npm и проходит `auth status`;
- пользователь выбирает проект по ID или точному имени;
- read-only команды имеют human и stable JSON output;
- разрешённые мутации идут через CommandService с actorId и receipt;
- права, scopes, тарифы и project access проверяются сервером;
- повтор mutating request не создаёт дубль;
- токены не попадают в логи, shell history и диагностический вывод;
- OpenAPI, CLI help и behavior tests описывают один и тот же контракт.
