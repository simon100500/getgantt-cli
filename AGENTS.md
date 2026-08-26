# Инструкция агенту GetGantt

Эти правила можно положить в `AGENTS.md` проекта, где агент должен работать
с GetGantt через установленный CLI.

## Подключение

Перед первым вызовом убедитесь, что CLI установлен:

```bash
npm install --global getgantt-cli
gantt --help
```

Нужен personal access token GetGantt. Пользователь выпускает его в личном
кабинете и один раз настраивает авторизацию:

```bash
gantt auth login
gantt --json auth status
```

Для CI и других неинтерактивных запусков токен передаётся через
`GETGANTT_TOKEN`. Не запрашивайте токен в чате и не передавайте его аргументом
команды:

```bash
gantt --json auth status
```

Если CLI используется с локальным GetGantt, добавляйте к каждой команде:

```text
--server http://localhost:5173
```

Для production параметр `--server` не нужен. Не добавляйте к нему
`/api/cli/v1`.

## Как агент выбирает проект

Если пользователь не дал UUID проекта, сначала выполните:

```bash
gantt --json projects list
```

Попросите пользователя выбрать проект, если доступно несколько вариантов.
Нельзя выбирать проект по частичному имени или угадывать UUID.

После выбора передавайте UUID явно в каждой команде:

```bash
gantt --project <project-uuid> --json project show
gantt --project <project-uuid> --json tasks list --limit 500
```

Для интерактивного пользователя выбор можно сохранить:

```bash
gantt projects use <project-uuid-or-exact-name>
gantt projects current
```

## Рабочий цикл агента

Для чтения используйте `--json`:

```bash
gantt --project <project-uuid> --json project show
gantt --project <project-uuid> --json tasks list
gantt --project <project-uuid> --json tasks find "Фундамент"
gantt --project <project-uuid> --json tasks show <task-uuid>
gantt --project <project-uuid> --json schedule validate
gantt --project <project-uuid> --json tools list
```

## Карта возможностей

Публичный CLI-каталог покрывает следующие группы операций:

- чтение проекта, расписания, задач, иерархии и зависимостей;
- создание задач и изменение их метаданных и структуры;
- сдвиг задач, изменение длительности, сдвиг всего проекта и перерасчёт;
- создание и удаление зависимостей;
- шаблоны работ, локации, назначения и рабочие зависимости;
- проверка расписания и чтение версий доменных пакетов.

Полный список имён и JSON-схем всегда получайте командой:

```bash
gantt --json tools list
```

Перед изменением:

1. проверьте текущий проект, версию графа и нужные ID;
2. подготовьте JSON-файл, если команда использует `--file`;
3. сначала выполните ту же команду с `--dry-run`;
4. проверьте preview: проект, задачи, зависимости и параметры;
5. только после этого повторите команду без `--dry-run`;
6. в JSON-ответе проверьте `receipt`, `newVersion` и изменённые ID.

Примеры коротких команд:

```bash
    gantt --project <project-uuid> --json tasks update --file update.json --dry-run
    gantt --project <project-uuid> --json tasks update --file update.json
    gantt --project <project-uuid> --json tasks shift <task-id> --days 22 --dry-run
    gantt --project <project-uuid> --json tasks duration <task-id> --days 10 --dry-run
    gantt --project <project-uuid> --json dependencies link --from <id> --to <id> --type FS --dry-run
    gantt --project <project-uuid> --json schedule shift --days 3 --dry-run
    gantt --project <project-uuid> --json schedule recalculate --dry-run
```

Для полного зеркального доступа к публичному каталогу:

```bash
gantt --project <project-uuid> --json tools call <tool-name> --file args.json --dry-run
```

`tools call` сам читает схему с сервера, передаёт текущую версию проекта и
создаёт ключ идемпотентности. Для мутации после проверки preview добавьте
`--yes` и повторите ту же команду без `--dry-run`.

Правила выбора операции:

- `tasks update` меняет только `name`, `color`, `progress`, `workVolume` и `workUnit`;
- даты конкретной задачи меняются через `tasks shift` / `shift_tasks`, а не через `tasks update`;
- для изменения длительности используйте `tasks duration` / `change_task_duration`;
- `schedule shift` / `shift_project` предназначен только для всего проекта;
- при сдвиге родительской задачи не сдвигайте её дочерние задачи вручную: сервер
  переносит иерархию и зависимый каскад сам.

Для удаления и сдвига всего графика в неинтерактивном режиме добавляйте
`--yes`. Preview не является выполненным изменением.

Если команда вернула код `7` или HTTP `409`, перечитайте проект и контекст
задачи. После таймаута сначала проверьте, изменился ли проект, и не повторяйте
мутацию вслепую: новый процесс CLI создаёт новый idempotency key.

## Секреты и результаты

- Не выводите и не сохраняйте PAT.
- Не вставляйте PAT в `AGENTS.md`, prompt, JSON-файлы или логи.
- Не считайте текст `success` или HTTP-ответ без receipt доказательством
  изменения.
- При неоднозначном имени задачи остановитесь и попросите уточнение.
- Ошибки в режиме `--json` находятся в stderr; сохраняйте `requestId` для
  диагностики, но не сохраняйте секреты.
