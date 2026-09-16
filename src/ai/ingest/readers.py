"""Читаем xlsx/csv/json в сырые таблицы: {name_table: list[row-dicts]}"""
from __future__ import annotations

from pathlib import Path


def _clean(v) -> str:
    if v is None:
        return ""
    return str(v).strip()


def _rows_from_dicts(headers, payload):
    headers = [_clean(h) for h in headers]
    out = []
    for row in payload:
        row = row or []
        if any(h for h in row):
            out.append(dict(zip(headers, row)))
    return out


def read_xlsx(path: Path) -> list[list[dict[str, str]]]:
    from openpyxl import load_workbook

    wb = load_workbook(path, data_only=True, read_only=True)
    tables = []
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        # разбить лист на под-блоки: секции по пустым строкам
        blocks: list[list[tuple]] = []
        cur: list[tuple] = []
        for r in rows:
            if r is None or all(v is None for v in r):
                if cur:
                    blocks.append(cur)
                    cur = []
                continue
            cur.append(r)
        if cur:
            blocks.append(cur)
        for block in blocks:
            cleaned = [[_clean(v) for v in row] for row in block]
            # первая строка блока = заголовок, если вторая похожа на данные;
            # иначе первая строка — титул секции, вторая — заголовок
            if len(block) >= 2:
                first_non_empty = sum(1 for c in block[0] if c)
                second_non_empty = sum(1 for c in block[1] if c)
                if first_non_empty <= 1 and second_non_empty > first_non_empty:
                    tables.append(_rows_from_dicts(block[1], block[2:]))
                    continue
            tables.append(_rows_from_dicts(block[0], block[1:]))
    return tables


def read_csv(path: Path) -> list[list[dict[str, str]]]:
    import csv

    tables = []
    with path.open(encoding="utf-8-sig") as fh:
        sniffer = csv.Sniffer()
        sample = fh.read(2048)
        fh.seek(0)
        try:
            delimiter = sniffer.sniff(sample).delimiter
        except csv.Error:
            delimiter = ","
        reader = csv.DictReader(fh, delimiter=delimiter)
        tables.append([dict(r) for r in reader if any(str(v).strip() for v in r.values())])
    return tables


def read_json(path: Path) -> list[list[dict[str, str]]]:
    data = path.read_text(encoding="utf-8-sig")
    import json

    obj = json.loads(data)
    if isinstance(obj, dict):
        tables = []
        for key, table in obj.items():
            if isinstance(table, list):
                tables.append([dict(r) for r in table])
        return tables
    if isinstance(obj, list):
        return [[dict(r) for r in obj]]
    raise ValueError("JSON должен быть списком объектов или {таблица: [ ... ]}")


READERS = {".xlsx": read_xlsx, ".csv": read_csv, ".json": read_json}


def read_any(path: Path) -> list[list[dict[str, str]]]:
    reader = READERS.get(path.suffix.lower())
    if not reader:
        raise ValueError(f"неподдерживаемый формат: {path.suffix}")
    tables = reader(path)
    return [t for t in tables if t]
