# GetGantt CLI

Официальный CLI-клиент GetGantt для терминала, скриптов, CI и AI-агентов.
Он подключается к GetGantt по HTTPS и работает с теми проектами, которые
доступны текущему personal access token.

Пакет опубликован в npm:

- пакет: [`getgantt-cli`](https://www.npmjs.com/package/getgantt-cli)
- текущая опубликованная версия: `0.1.0`
- команда после установки: `gantt`

## Требования

- Node.js 22 или новее;
- personal access token (PAT) GetGantt с нужными scope и доступом к проекту.

## Установка

Глобальная установка:

```bash
npm install --global getgantt-cli
gantt --help
```

Локальная установка в проект:

```bash
npm install --save-dev getgantt-cli
npx gantt --help
```

## Авторизация

Выпустите personal access token в личном кабинете GetGantt. Секрет токена
передаётся CLI через скрытый prompt или stdin, а не через аргумент командной
строки.

Для интерактивного входа:

```bash
gantt auth login
gantt auth status
```

Если token нужно подать через stdin, используйте
`gantt auth login --token-stdin`. Для CI всё равно предпочтительнее
переменная `GETGANTT_TOKEN`, чтобы не создавать промежуточный файл с
секретом.

Именованный профиль:

```bash
gantt auth login --name work
gantt auth profiles list
gantt auth profiles use work
gantt auth logout --name work
```

Для CI и неинтерактивных агентов используйте переменную окружения:

```bash
# macOS/Linux
export GETGANTT_TOKEN='ggt_pat_...'
gantt --json auth status

# PowerShell
$env:GETGANTT_TOKEN = 'ggt_pat_...'
gantt --json auth status
Remove-Item Env:GETGANTT_TOKEN
```

`GETGANTT_TOKEN` имеет приоритет над сохранённым профилем. Не помещайте токен
в аргументы команд, README, `AGENTS.md`, исходники, issue или логи CI.

Сохранённые профили находятся в пользовательском конфигурационном файле:

- Windows: `%APPDATA%\\GetGantt\\config.json`;
- macOS/Linux: `$XDG_CONFIG_HOME/getgantt/config.json` или
  `~/.config/getgantt/config.json`.

Файл создаётся с ограниченными правами доступа. Для CI предпочтительнее
`GETGANTT_TOKEN`, чтобы секрет не записывался на диск.

## Production и локальный сервер

По умолчанию CLI использует production:

```text
https://ai.getgantt.ru
```

Для локального GetGantt используйте origin фронтенда или dev-прокси:

```bash
gantt --server http://localhost:5173 --json auth status
gantt --server http://localhost:5173 --project <project-id> --json project show
```

Не добавляйте к `--server` путь `/api/cli/v1`: CLI добавляет API-маршрут
самостоятельно. `--api-url` — совместимый алиас `--server`.

Глобальные параметры можно указывать перед командой:

```text
--json                 машинно-читаемый JSON в stdout
--server <url>         origin GetGantt-сервера
--api-url <url>        алиас --server
--profile <name>       локальный профиль
--project <id-or-name> UUID или точное имя проекта
--timeout <ms>         таймаут HTTP-запроса, по умолчанию 30000
```

## Выбор проекта

Сначала получите проекты, доступные текущему токену:

```bash
gantt --json projects list
```

Для автоматизации всегда используйте UUID проекта явно:

```bash
gantt --project 3dbd4a66-9dd8-4da1-93d2-1bfe6459a14f --json project show
gantt --project 3dbd4a66-9dd8-4da1-93d2-1bfe6459a14f --json tasks list
```

Для интерактивного профиля можно сохранить выбор:

```bash
gantt projects use <project-id-or-exact-name>
gantt projects current
```

Если доступен ровно один проект, CLI может выбрать его автоматически. При
нескольких проектах команда требует `--project` или сохранённый выбор. Имена
сравниваются точно; неоднозначное имя не выбирается автоматически.

## Команды

### Чтение

```bash
gantt project show
gantt projects list
gantt projects current
gantt tasks list --limit 500
gantt tasks find "Фундамент"
gantt tasks show <task-id>
gantt schedule validate
gantt schedule slice --start 2026-09-01 --end 2026-09-30
```

`tasks list` ограничен: по умолчанию возвращается до 500 задач, максимально —
5000. `tasks show` возвращает контекст задачи, иерархию и зависимости.

### Изменение

```bash
gantt tasks create --file create.json --dry-run
gantt tasks create --file create.json
gantt tasks update --file update.json --dry-run
gantt tasks move --file moves.json --dry-run
gantt dependencies link --from <predecessor-id> --to <successor-id> --type FS --dry-run
gantt dependencies unlink --from <predecessor-id> --to <successor-id> --dry-run
gantt schedule shift --days 3 --dry-run
```

После проверки preview примените ту же операцию без `--dry-run`. Для удаления
и сдвига всего графика в неинтерактивном режиме требуется `--yes`:

```bash
gantt tasks delete <task-id> --yes
gantt schedule shift --days 3 --yes
```

В интерактивном режиме без `--yes` CLI запрашивает подтверждение. В dry-run
подтверждение не требуется. `--dry-run` выполняется сервером: проект не
изменяется, а ответ содержит признак preview.

Каждая мутация читает текущую версию графа, передаёт `baseVersion` и
`Idempotency-Key`, а после успешного изменения возвращает receipt с новой
версией и изменёнными ID. При конфликте версии не повторяйте команду вслепую:
сначала перечитайте проект и актуальный контекст задачи.

## JSON-файлы для мутаций

Файл передаётся через `--file`. CLI принимает JSON-объект или JSON-массив;
массив трактуется как `{ "items": [...] }`.

Создание относительного графа. Даты отдельных задач не передаются — их
рассчитывает сервер:

```json
{
  "startAnchor": "2026-09-01",
  "items": [
    {
      "key": "foundation",
      "name": "Фундамент",
      "kind": "group"
    },
    {
      "key": "excavate",
      "name": "Разработка котлована",
      "kind": "task",
      "parentKey": "foundation",
      "durationDays": 5,
      "dependsOn": [],
      "workVolume": 120,
      "workUnit": "м³"
    }
  ]
}
```

Обновление метаданных:

```json
{
  "updates": [
    {
      "id": "task-id",
      "name": "Новое название",
      "progress": 50,
      "workVolume": 120,
      "workUnit": "м³"
    }
  ]
}
```

Перемещение задач:

```json
{
  "moves": [
    {
      "taskId": "task-id",
      "parentId": "new-parent-id"
    }
  ]
}
```

Актуальные HTTP-контракты опубликованы в
[OpenAPI](https://github.com/simon100500/getgantt-cli/blob/main/docs/openapi.yaml).

## Использование AI-агентом

Агенту достаточно доступа к `gantt` в PATH и заранее настроенной авторизации.
Для машинной обработки он должен использовать `--json`, а для каждой операции
передавать `--project <UUID>`.

Безопасный рабочий цикл:

1. проверить `gantt --json auth status`;
2. получить проект и текущую версию через `project show`;
3. найти и проверить нужные задачи через `tasks list`, `tasks find` или
   `tasks show`;
4. сформировать JSON-файл и выполнить мутацию с `--dry-run`;
5. проверить preview и только затем повторить команду без `--dry-run`;
6. проверить `receipt`, `newVersion` и изменённые ID в JSON-ответе;
7. при `409` перечитать проект и запросить решение, а не перезаписывать
   свежие изменения.

Агент не должен выдумывать ID, выбирать проект по частичному имени, раскрывать
токен или считать preview доказательством изменения. Для работы с GetGantt
агент использует команду `gantt`.

Готовые правила для агента находятся в
[`AGENTS.md`](https://github.com/simon100500/getgantt-cli/blob/main/AGENTS.md),
а reusable skill — в
[`skills/getgantt-cli/SKILL.md`](https://github.com/simon100500/getgantt-cli/blob/main/skills/getgantt-cli/SKILL.md).

## Коды завершения

```text
0  успех
2  ошибка CLI, сети или неклассифицированная ошибка
3  токен отсутствует, просрочен или отозван (HTTP 401)
4  недостаточно scope или прав проекта (HTTP 403)
5  ресурс не найден или недоступен токену (HTTP 404)
6  некорректные аргументы (HTTP 400/422)
7  конфликт версии графа (HTTP 409)
8  rate limit или ошибка сервера (HTTP 429/5xx)
```

В режиме `--json` ошибки выводятся в stderr как JSON с `code`, `details` и
`requestId`, если сервер их вернул. Секрет токена в ошибках не выводится.

## Разработка CLI

```bash
npm install
npm run build
npm test
npm pack --dry-run
```

Пакет требует Node.js 22+, использует TypeScript и Commander.js. CLI остаётся
тонким клиентом: доменные проверки, версии графа, права и receipts принадлежат
серверу GetGantt.

## Публикация

Пакет уже опубликован публично. Последующие версии публикуются workflow
GitHub Actions после публикации GitHub Release:

1. увеличить версию в `package.json` и обновить lock-файл;
2. создать тег вида `v1.2.3` и GitHub Release на этом теге;
3. опубликовать Release, не оставляя его draft и prerelease;
4. workflow проверит тег, установит зависимости, запустит тесты и выполнит
   `npm publish` через npm Trusted Publishing/OIDC.

Для автоматической публикации один раз настройте на npm Trusted Publisher:

```text
Owner: simon100500
Repository: getgantt-cli
Workflow: publish.yml
Permission: npm publish
```

Токен npm в GitHub Secrets для этого workflow не нужен. Серверный API и CLI
релизуются независимо: сначала API должен быть доступен в нужном окружении,
затем можно публиковать совместимую версию CLI. Операционный checklist
находится в
[`docs/deployment.md`](https://github.com/simon100500/getgantt-cli/blob/main/docs/deployment.md).
