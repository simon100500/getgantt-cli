# GetGantt CLI

Планируемый интерфейс командной строки для работы с GetGantt из терминала,
скриптов, CI и локальных AI-агентов.

CLI является отдельным клиентом публичного GetGantt API. Он не подключается к
PostgreSQL, не импортирует серверное доменное ядро и не содержит собственной
логики календарно-сетевого планирования.

Текущий документ проекта: [план разработки](docs/development-plan.md).

## Первый CLI-срез

Локальная разработка:

```bash
npm install
npm run build
node dist/index.js --help
```

Публикуемая установка после выхода пакета:

```bash
npm install -g getgantt-cli
gantt auth login
gantt projects list
```

`auth login` проверяет PAT через `GET /api/cli/v1/me` и сохраняет профиль на
локальной машине. Полный секрет токена не передаётся аргументом командной
строки. Для CI можно использовать:

```bash
GETGANTT_TOKEN=ggt_pat_... gantt --json projects list
```

В MVP credentials хранятся в файле пользователя с ограниченными правами;
интеграция с системным keychain запланирована отдельным этапом.

Доступные рабочие команды текущего среза:

```bash
gantt project show
gantt tasks list --json
gantt tasks find "фундамент"
gantt tasks show <task-id>
gantt schedule validate
gantt schedule shift --days 3 --yes
gantt tasks create --file create.json
gantt tasks update --file update.json
gantt tasks delete <task-id> --yes
gantt dependencies link --from <predecessor> --to <successor> --type FS
gantt tasks move --file moves.json --dry-run
```

Публичный контракт находится в [OpenAPI](docs/openapi.yaml). Операции чтения и
изменения проходят через общий typed catalog; mutation calls требуют текущий
`baseVersion` и `Idempotency-Key`, а ответ содержит authoritative receipt.
Флаг `--dry-run` выполняется сервером: CLI не имитирует изменение локально и не
пишет в проект.

Релизная последовательность и безопасное применение Prisma migration описаны в
[deployment checklist](docs/deployment.md). Серверные routes уже зарегистрированы
в проекте, но миграцию и публикацию npm нужно выполнять отдельно в окружении
релиза.
