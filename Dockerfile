# Бэкенд: uv + python 3.13, dataset внутри образа (POST /data/import читает каталог)
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

# Зависимости отдельным слоем: кэш docker качает их один раз
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY src ./src
COPY dataset ./dataset

ENV POSTCODE_DATABASE_URL="postgresql+asyncpg://postcode:postcode@db:5432/postcode" \
    PYTHONUNBUFFERED=1

EXPOSE 8000
HEALTHCHECK --interval=3s --timeout=3s --retries=20 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')" || exit 1

CMD ["uv", "run", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
