from __future__ import annotations

from src.domain import models


def topo_order(tasks: list[str], deps: list[tuple[str, str]]) -> list[str] | None:
    """Топологическая сортировка; None при цикле.
    deps: (blocking, blocked) — blocking должен быть раньше blocked."""
    indeg = {t: 0 for t in tasks}
    adjacency: dict[str, list[str]] = {t: [] for t in tasks}
    for blocking, blocked in deps:
        if blocking in indeg and blocked in indeg:
            adjacency[blocking].append(blocked)
            indeg[blocked] += 1
    queue = sorted(t for t, d in indeg.items() if d == 0)
    order: list[str] = []
    while queue:
        node = queue.pop(0)
        order.append(node)
        for nxt in adjacency[node]:
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                queue.append(nxt)
                queue.sort()
    if len(order) != len(tasks):
        return None
    return order


def find_cycle(deps: list[tuple[str, str]], tasks: list[str]) -> list[str]:
    graph = {t: [] for t in tasks}
    for blocking, blocked in deps:
        if blocking in graph and blocked in graph:
            graph[blocking].append(blocked)
    visited: set[str] = set()
    stack: list[str] = []
    on_stack: set[str] = set()

    def dfs(node: str) -> list[str] | None:
        visited.add(node)
        stack.append(node)
        on_stack.add(node)
        for nxt in graph[node]:
            if nxt in on_stack:
                return stack[stack.index(nxt):] + [nxt]
            if nxt not in visited:
                res = dfs(nxt)
                if res:
                    return res
        on_stack.discard(node)
        stack.pop()
        return None

    for t in tasks:
        if t not in visited:
            res = dfs(t)
            if res:
                return res
    return []


def blocked_chain(task_id: str, deps: list[tuple[str, str]]) -> list[str]:
    """Все задачи, зависящие от task_id прямо или транзитивно."""
    forward: dict[str, list[str]] = {}
    for blocking, blocked in deps:
        forward.setdefault(blocking, []).append(blocked)
    seen: list[str] = []
    queue = [task_id]
    while queue:
        cur = queue.pop(0)
        for nxt in forward.get(cur, []):
            if nxt not in seen and nxt != task_id:
                seen.append(nxt)
                queue.append(nxt)
    return seen
