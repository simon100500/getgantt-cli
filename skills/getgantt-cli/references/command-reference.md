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
    gantt tools list

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
    gantt schedule recalculate [--dry-run]
    gantt tasks shift <task-id> --days <signed-number> [--dry-run]
    gantt tasks duration <task-id> --days <number> [--anchor start|end] [--dry-run]

Для полного публичного каталога без отдельной обёртки:

    gantt tools call <tool-name> --file <arguments.json> [--yes] [--dry-run]

`tools list` возвращает актуальные JSON-схемы. Публичные операции включают:

    get_project_summary       get_schedule_slice       find_tasks
    get_task_context          create_tasks             update_tasks
    move_tasks                shift_project            shift_tasks
    change_task_duration      delete_tasks             link_tasks
    unlink_tasks               recalculate_project      validate_schedule
    list_domain_packs          get_domain_pack          create_work_template
    update_work_template       delete_work_template    create_location
    update_location             delete_location         create_work_dependency
    remove_work_dependency      assign_work             move_work_dates
    reset_assignment            list_work_templates     list_locations
    list_work_dependencies

В каталоге также видны встроенные read-команды `projects.list`, `projects.get` и
`schedule.tasks.list`; `tools call` выполняет их через соответствующие локальные
команды CLI.

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

Сдвиг конкретной задачи:

    {
      "shifts": [
        {"taskId": "task-id", "delta": 22}
      ]
    }

Изменение длительности:

    {
      "changes": [
        {"taskId": "task-id", "durationDays": 10, "anchor": "end"}
      ]
    }

JSON-массив тоже принимается, но оборачивается CLI как { "items": [...] };
для мутаций используй объектные формы выше.

Важно: `tasks update` / `update_tasks` меняет только метаданные задачи. Даты
меняются через `tasks shift` / `shift_tasks`, длительность — через `tasks duration`
/ `change_task_duration`, а весь проект — через `schedule shift` / `shift_project`.
