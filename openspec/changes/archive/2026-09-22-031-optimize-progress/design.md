# Design: 031-optimize-progress

Схема: цикл опроса на mutation level (poll-функция с sleep 2 c и предельными статусами), чтобы не таскать глобальный refetch. Индикатор — существующий `loading={optimize.isPending}` кнопки; текст подписи меняется на «Solver работает…» (плановый change 028 семантика). При терминальном статусе: invalidatePlans (invalidate уже в onSuccess) и toast с modeLabel/degradation_reason. При poll-таймауте: toast error «Solver не уложился в бюджет — проверьте статус задачи» (п Roosevelt job продолжает работать в очереди).
