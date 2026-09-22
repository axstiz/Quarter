# Design: 030-gigachat-ca-container

Единственный репозиторий доверия — хост (NixOS, `security.pki.certificateFiles` уже содержит root+sub CA Минцифры). Монтируем си же путь внутрь контейнеров, .env без правок. Ошибку нашедшего Gone_hunting (FileNotFoundError) конвертируем в GigaUnavailable — советник по спеке 015/027 деградирует в fallback. Область: только SDK-инициализация; логика советника не трогается.
