"""Wirelog engine sidecar for iso-agent.

Uses PyreWire when available; otherwise evaluates the same MVP queries in pure Python.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="iso-agent-engine", version="0.1.0")

try:
    from pyrewire import EasySession  # type: ignore

    HAS_PYREWIRE = True
except Exception:
    HAS_PYREWIRE = False


class QueryBody(BaseModel):
    type: str
    id: str = ""
    facts: list[dict[str, Any]] = []


def approved_edges(facts: list[dict[str, Any]]) -> list[tuple[str, str, str, str]]:
    out = []
    for f in facts:
        if f.get("status") not in ("approved", "auto_approved"):
            continue
        out.append((f["subject"], f["predicate"], f["object"], f["id"]))
    return out


def reach(edges, start: str, predicate: str):
    seen = {start}
    queue = [(start, [])]
    results = []
    while queue:
        node, path = queue.pop(0)
        for s, p, o, fid in edges:
            if p != predicate or s != node or o in seen:
                continue
            seen.add(o)
            npath = path + [fid]
            results.append({"node": o, "path": npath})
            queue.append((o, npath))
    return results


def reverse_depends(edges, root: str):
    """Who depends on root (A depends_on root => A is impacted when root changes)."""
    seen = {root}
    queue = [(root, [])]
    results = []
    while queue:
        node, path = queue.pop(0)
        for s, p, o, fid in edges:
            if p != "depends_on" or o != node or s in seen:
                continue
            seen.add(s)
            npath = path + [fid]
            results.append({"node": s, "path": npath})
            queue.append((s, npath))
    return results


def evidence_candidates(edges, requirement_id: str | None):
    addresses = [e for e in edges if e[1] == "addresses"]
    requires = [e for e in edges if e[1] == "requires_record"]
    instances = [e for e in edges if e[1] == "instance_of"]
    direct = [e for e in edges if e[1] == "evidence_for"]
    out = []
    for s, _p, req, fid_a in addresses:
        if requirement_id and req != requirement_id:
            continue
        for ds, _rp, tmpl, fid_r in requires:
            if ds != s:
                continue
            for rec, _ip, tobj, fid_i in instances:
                if tobj != tmpl:
                    continue
                out.append(
                    {"record": rec, "requirement": req, "via": [fid_a, fid_r, fid_i]}
                )
    for rec, _p, req, fid in direct:
        if requirement_id and req != requirement_id:
            continue
        out.append({"record": rec, "requirement": req, "via": [fid]})
    return out


def missing_evidence(edges, scope: list[str] | None):
    addresses = [e for e in edges if e[1] == "addresses"]
    requires = [e for e in edges if e[1] == "requires_record"]
    instances = [e for e in edges if e[1] == "instance_of"]
    covered = {e[2] for e in instances}
    missing = []
    for s, _p, req, _fid in addresses:
        if scope and req not in scope:
            continue
        for ds, _rp, tmpl, _fidr in requires:
            if ds != s:
                continue
            if tmpl not in covered:
                missing.append(
                    {"requirement": req, "document": s, "template": tmpl}
                )
    return missing


def trace(edges, requirement_id: str):
    docs = [e for e in edges if e[1] == "addresses" and e[2] == requirement_id]
    templates = []
    records = []
    for s, _p, _req, fid in docs:
        for ds, _rp, tmpl, fidr in edges:
            if _rp != "requires_record" or ds != s:
                continue
            templates.append({"document": s, "template": tmpl, "factId": fidr})
            for rec, ip, tobj, fidi in edges:
                if ip != "instance_of" or tobj != tmpl:
                    continue
                records.append({"record": rec, "template": tmpl, "factId": fidi})
    return {
        "documents": [
            {"subject": s, "predicate": p, "object": o, "factId": fid}
            for s, p, o, fid in docs
        ],
        "templates": templates,
        "records": records,
    }


@app.get("/health")
def health():
    return {"ok": True, "pyrewire": HAS_PYREWIRE}


@app.post("/query")
def query(body: QueryBody):
    edges = approved_edges(body.facts)

    # Optional: load into EasySession for future richer rules
    if HAS_PYREWIRE and body.type in ("impact",):
        try:
            session = EasySession()
            with open("rules.dl", encoding="utf-8") as fh:
                # rules file kept for parity; MVP evaluation uses Python helpers
                _ = fh.read()
            for s, p, o, _fid in edges:
                session.insert(f'fact("{s}","{p}","{o}").')
            session.snapshot()
        except Exception:
            pass

    if body.type == "trace":
        return {"type": "trace", "id": body.id, "result": trace(edges, body.id)}
    if body.type == "evidence":
        return {
            "type": "evidence",
            "id": body.id,
            "result": evidence_candidates(edges, body.id or None),
        }
    if body.type == "missing":
        return {
            "type": "missing",
            "result": missing_evidence(edges, [body.id] if body.id else None),
        }
    if body.type == "impact":
        return {
            "type": "impact",
            "id": body.id,
            "result": reverse_depends(edges, body.id),
        }
    return {"error": "unknown query type"}
