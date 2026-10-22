"""HTTP sidecar backed by actual Wirelog/PyreWire computation."""
from typing import Any, Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field

from wirelog import engine_info, run_query

app = FastAPI(title='iso-agent-engine', version='0.2.0')


class QueryBody(BaseModel):
    type: Literal['trace', 'evidence', 'missing', 'impact']
    id: str = ''
    facts: list[dict[str, Any]] = Field(default_factory=list)


@app.get('/health')
def health():
    return {'ok': True, **engine_info()}


@app.post('/query')
def query(body: QueryBody):
    return run_query(body.type, body.id, body.facts)
