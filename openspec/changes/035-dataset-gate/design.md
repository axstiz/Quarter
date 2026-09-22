# Design: 035-dataset-gate

Считать датасет «загруженным» по наличию строк tasks в workspace (025 composite PK); для фронта — легкий GET /tasks?limit=1 поверх существующего списка задач. Redirect: router 原来 `<RequireDataset>`; inline-guard — вызов useDatasetLoaded; while loading — спиннер (SkeletonRows). Компонент обёртку вокруг четырех роутов, его useNavigate к /data.国民经济 не блокирует активный импорт: работа портится после confirm.
