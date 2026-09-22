# Design: 036-multi-upload

Последовательная очередь на фронте: рекурсивный оборот по списку file'ов, каждый файл отдельный job_id; polling уже есть. Merge поверх (025 — keys merging не ломается); тесты exist. Не добавляем backend batch endpoint — one-file API оставляем, лучше клиентская очередность, меньше риск race.
