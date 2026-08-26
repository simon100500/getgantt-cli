---
name: getgantt-cli
description: >-
  Работать с проектами GetGantt через установленную команду gantt: читать
  график, создавать и изменять задачи, управлять зависимостями и расписанием.
  Использовать для агентских операций в GetGantt.
---

# GetGantt CLI

Используй команду gantt как интерфейс к GetGantt. Для точных payload и полного
списка команд прочитай
[references/command-reference.md](references/command-reference.md).

## Подключение

1. Проверь установку: gantt --help.
2. Проверь авторизацию: gantt --json auth status.
3. Если авторизация ещё не настроена, попроси пользователя выполнить
   gantt auth login самостоятельно. Не проси прислать PAT в чат.
4. В CI используй GETGANTT_TOKEN.
5. Для production не указывай --server; для локального GetGantt используй
   --server http://localhost:5173.

Токен нельзя передавать аргументом команды, писать в prompt, JSON-файл или лог.
Для неинтерактивной работы не используй сохранённый выбор проекта — передавай
--project <UUID> в каждой команде.

## Проект и чтение

Если UUID проекта неизвестен, сначала выполни:

    gantt --json projects list

Не выбирай проект по частичному имени и не выдумывай UUID. При нескольких
проектах попроси пользователя выбрать один. Затем читай контекст:

    gantt --project <project-uuid> --json project show
    gantt --project <project-uuid> --json tasks list --limit 500
    gantt --project <project-uuid> --json tasks find "Фундамент"
    gantt --project <project-uuid> --json tasks show <task-uuid>
    gantt --project <project-uuid> --json schedule validate

Если имя задачи неоднозначно, остановись и попроси уточнение.

## Изменения

Перед каждой мутацией:

1. получи текущую версию проекта и проверь целевые ID;
2. сформируй JSON-файл, если команда использует --file;
3. выполни команду с --json --dry-run;
4. проверь preview и убедись, что выбран правильный проект;
5. повтори ту же команду без --dry-run;
6. проверь в ответе receipt, newVersion и изменённые ID.

Для tasks delete и schedule shift в неинтерактивном режиме добавляй --yes.
Preview не является выполненным изменением.

При 409 или exit code 7 перечитай проект и контекст, не повторяй мутацию
вслепую. После таймаута сначала проверь, произошла ли операция; новый процесс
CLI создаёт новый idempotency key.

## Результаты и ошибки

Всегда используй --json в агентских вызовах. Успешная мутация подтверждается
receipt, а не только текстом stdout. Ошибки JSON выводятся в stderr; сохраняй
requestId для диагностики, но не сохраняй секреты.

Коды: 3 — auth, 4 — forbidden, 5 — not found, 6 — invalid input,
7 — конфликт версии, 8 — rate limit или ошибка сервера.
