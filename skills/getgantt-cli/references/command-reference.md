# GetGantt CLI: command reference

Все параметры --server, --profile, --project, --timeout и --json являются
глобальными. Для агента обычно нужны --json и явный --project.

## Авторизация и проект

    gantt auth login [--name <profile>]
    gantt auth status
    gantt auth profiles list
    gantt auth profiles use <profile>
    gantt auth logout [--name <profile>]
    gantt projects list
    gantt projects use <id-or-exact-name>
    gantt projects current
    gantt project show

auth login читает PAT через скрытый prompt или stdin, проверяет его и сохраняет
профиль. Для stdin используется --token-stdin. Переменная GETGANTT_TOKEN имеет
приоритет над сохранённым профилем.

## Чтение

    gantt tasks list [--limit <number>]
    gantt tasks find <query> [--limit <number>]
    gantt tasks show <task-id>
    gantt schedule validate
    gantt schedule slice [--start <YYYY-MM-DD>] [--end <YYYY-MM-DD>]

tasks list возвращает до 500 задач по умолчанию и максимум 5000; пагинация
сервера обрабатывается CLI внутри заданного лимита.

## Изменение

    gantt tasks create --file <json> [--dry-run]
    gantt tasks update --file <json> [--dry-run]
    gantt tasks move --file <json> [--dry-run]
    gantt tasks delete <task-id> [--yes] [--dry-run]
    gantt dependencies link --from <id> --to <id> [--type FS|SS|FF|SF] [--lag <days>] [--dry-run]
    gantt dependencies unlink --from <id> --to <id> [--dry-run]
    gantt schedule shift --days <signed-number> [--yes] [--dry-run]

CLI передаёт серверу текущий baseVersion и генерирует Idempotency-Key. Сервер
возвращает receipt с новой версией и изменёнными ID.

## JSON-файлы

Создание относительного графа:

    {
      "startAnchor": "2026-09-01",
      "items": [
        {"key": "phase", "name": "Фаза", "kind": "group"},
        {
          "key": "task",
          "name": "Задача",
          "kind": "task",
          "parentKey": "phase",
          "durationDays": 5,
          "dependsOn": [],
          "workVolume": 120,
          "workUnit": "м³"
        }
      ]
    }

Обновление:

    {
      "updates": [
        {"id": "task-id", "name": "Новое название", "progress": 50}
      ]
    }

Перемещение:

    {
      "moves": [
        {"taskId": "task-id", "parentId": "new-parent-id"}
      ]
    }

JSON-массив тоже принимается, но оборачивается CLI как { "items": [...] };
для мутаций используй объектные формы выше.
