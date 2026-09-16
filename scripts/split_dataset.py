"""Разбор датасета PostCode Challenge из Excel в нормализованные CSV.

Использование: uv run scripts/split_dataset.py
Источник: Датасет_с_правками_основной.xlsx (лист "Датасет(обновленный)")
Результат: dataset/*.csv

Структура листа: несколько таблиц последовательно накатаны друг на друга,
каждая секция начинается с заголовка ("Tasks (...)", "Spent_time_roles. ...", ...),
затем строка заголовков колонок, затем данные.
"""
from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "Датасет_с_правками_основной.xlsx"
OUT = ROOT / "dataset"
SHEET = "Датасет(обновленный)"

EXCEL_EPOCH = "1899-12-30"

DATE_COLUMNS = {"created_at", "planned_start", "planned_end", "actual_start", "actual_end", "snapshot_date"}

CAMEL_TO_SNAKE = re.compile(r"(?<=[a-z0-9])([A-Z])")

COLUMNS_EN = {
    "номер_инициативы": "initiative_no",
    "статус": "status",
    "ранг": "rank",
    "плановый_результат": "planned_result",
    "будет_включено_в_спринт": "planned_in_sprint",
    "заказчик": "customer_result",
    "исполнитель": "performer_result",
    "итоговый_результат": "final_result",
}


def excel_date_to_iso(value) -> str:
    if value is None or value == "" or (isinstance(value, float) and pd.isna(value)):
        return ""
    if isinstance(value, pd.Timestamp):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, str):
        text = value.strip()
        ts = pd.to_datetime(text, dayfirst=False, errors="coerce")
        if pd.notna(ts):
            return ts.strftime("%Y-%m-%d")
        value = re.sub(r"[\s,]+", ".", text)
        try:
            value = float(value)
        except ValueError:
            return value
    return (pd.Timestamp(EXCEL_EPOCH) + pd.Timedelta(days=float(value))).strftime("%Y-%m-%d")


def to_snake(name: str) -> str:
    name = str(name).strip().lower().replace("ё", "е")
    name = CAMEL_TO_SNAKE.sub(r"_\1", name)
    name = re.sub(r"[\s/()\[\].,;:!?№+\"'`=–—-]+", "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    return COLUMNS_EN.get(name, name)


def normalize(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [to_snake(c) for c in df.columns if str(c).strip()]
    for col in df.columns:
        if col in DATE_COLUMNS:
            df[col] = df[col].map(excel_date_to_iso)
        else:
            df[col] = df[col].map(lambda x: x.strip() if isinstance(x, str) else x)
        if pd.api.types.is_numeric_dtype(df[col]):
            df[col] = df[col].map(lambda x: str(int(x)) if x == x and pd.notna(x) and float(x).is_integer() else ("" if not pd.notna(x) else str(x))).fillna("")
    return df


def cell_text(value) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def read_raw() -> pd.DataFrame:
    return pd.read_excel(XLSX, sheet_name=SHEET, header=None, engine="openpyxl")


def find_row(raw: pd.DataFrame, pattern: str, col: int = 0, start: int = 0) -> int:
    for idx in range(start, len(raw)):
        if re.search(pattern, cell_text(raw.iloc[idx, col])):
            return idx
    raise ValueError(f"Секция '{pattern}' (колонка {col}) не найдена")


def read_block(raw: pd.DataFrame, header_row: int, width: int, header_col: int = 0) -> pd.DataFrame:
    """Строки после header_row до первой полностью пустой строки.

    header_row — индекс строки заголовков.
    header_col — номер колонки, начиная с которой идут имена колонок.
    """
    shifted = raw.iloc[header_row, header_col : header_col + width].tolist()
    header = [""] * header_col + [cell_text(v) for v in shifted]
    rows = []
    for i in range(header_row + 1, len(raw)):
        row = [cell_text(v) for v in raw.iloc[i, :width]]
        if not any(row):
            break
        rows.append(row)
    return pd.DataFrame(rows, columns=[h or f"col_{j}" for j, h in enumerate(header)])


def export(df: pd.DataFrame, name: str) -> None:
    df.to_csv(OUT / name, index=False)
    print(f"  {name}: {len(df)} строк, {len(df.columns)} колонок")


def parse_tasks(raw: pd.DataFrame) -> None:
    header = find_row(raw, r"^task_id$", col=1)
    tasks = normalize(read_block(raw, header, 20))
    export(tasks, "tasks.csv")


def parse_role_hours(raw: pd.DataFrame) -> None:
    header = find_row(raw, r"^task_id$")
    roles_row = raw.iloc[header, 2:].tolist()
    width = 2 + sum(1 for v in roles_row if cell_text(v))
    hours = normalize(read_block(raw, header, width))
    export(hours, "task_role_hours.csv")


def parse_requirements(raw: pd.DataFrame) -> None:
    header = find_row(raw, r"^Роль$")
    first = find_row(raw, r"^Итого по ролям$")
    n_tasks = 0
    for c in range(1, raw.shape[1]):
        if cell_text(raw.iloc[header, c]):
            n_tasks += 1
    table = read_block(raw, header, 1 + n_tasks)
    table = table[table.iloc[:, 0] != "Итого по ролям"]
    matrix = normalize(table)
    matrix.columns = ["role"] + [cell_text(v).strip() for v in raw.iloc[header, 1 : 1 + n_tasks]]
    long_df = matrix.melt(id_vars="role", var_name="task_id", value_name="hours")
    long_df = long_df[(long_df["hours"] != "") & (long_df["hours"] != "0")]
    long_df["hours"] = long_df["hours"].map(lambda v: str(int(float(v))) if v else "")
    preview = matrix.head()
    export(long_df, "task_role_requirements.csv")
    return preview


def parse_dependencies(raw: pd.DataFrame) -> None:
    """В файле заголовки C/D смещены относительно данных (данные в A/B/C)."""
    header = find_row(raw, r"^blocking_task_id")
    rows = []
    for i in range(header + 1, len(raw)):
        vals = [cell_text(v) for v in raw.iloc[i, :3]]
        if not any(vals):
            break
        while len(vals) < 3:
            vals.append("")
        rows.append(vals)
    deps = pd.DataFrame(rows, columns=["blocking_task_id", "blocked_task_id", "dependency_type"])
    deps = normalize(deps)
    export(deps, "task_dependencies.csv")


def parse_engineers(raw: pd.DataFrame) -> None:
    header = find_row(raw, r"^engineer_id$")
    eng = normalize(read_block(raw, header, 6))
    export(eng, "engineers_profiles.csv")


def parse_history(raw: pd.DataFrame) -> None:
    header = find_row(raw, r"^snapshot_date$")
    hist = normalize(read_block(raw, header, 4))
    export(hist, "team_history.csv")


REFERENCE_GROUPS = [
    (r"^Итог разработки", "development_outcome"),
    (r"^Причины расхождения", "deviation_reason"),
    (r"^Результаты работ при закрытии", "closure_result"),
]


def parse_references(raw: pd.DataFrame) -> None:
    start = find_row(raw, REFERENCE_GROUPS[0][0])
    rows = []
    for i in range(start, len(raw)):
        text = cell_text(raw.iloc[i, 0])
        if not text:
            continue
        matched = None
        for pattern, name in REFERENCE_GROUPS:
            if re.match(pattern, text):
                matched = name
                break
        if matched:
            if not rows or rows[-1][0] != matched:
                rows.append((matched, text))
        elif rows:
            rows.append((rows[-1][0], text))
    refs = pd.DataFrame(rows, columns=["value_type", "value"])
    export(refs, "reference_values.csv")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    raw = read_raw()
    print(f"Источник: {XLSX.name}, лист '{SHEET}', строк: {len(raw)}")
    print("Разбор:")
    parse_tasks(raw)
    parse_role_hours(raw)
    parse_requirements(raw)
    parse_dependencies(raw)
    parse_engineers(raw)
    parse_history(raw)
    parse_references(raw)
    print("Готово → dataset/")


if __name__ == "__main__":
    main()
