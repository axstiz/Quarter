# Design: 040-pin-clean-move

Идея: единственный источник раскладки — сервер (БД), считывается через refetch. Никаких клиентских override-слоёв (localStorage/in-memory копий) — удаляются остатки change 038/032 («optimistic» и баннеры). Драг работает честно: university server move (039) + invalidate → fresh plan сразу после pin. Полный spec-текст копируется в delta без уterянных сценариев (проверено validate).
