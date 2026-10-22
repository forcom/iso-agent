"""Real PyreWire evaluation; Python only formats rows and fact-id witnesses."""
from __future__ import annotations

from collections import deque
from hashlib import sha256
from importlib.metadata import version
from pathlib import Path

from pyrewire import EasySession

RULES_PATH = Path(__file__).with_name('rules.dl')
RELATIONS = ('direct', 'trace_document', 'trace_template', 'trace_record',
             'evidence_path', 'evidence_candidate', 'missing_evidence', 'impact_item', 'has_permission')


def engine_info():
    return {'engine': 'pyrewire', 'engine_version': version('pyrewire'),
            'rules_sha256': sha256(RULES_PATH.read_bytes()).hexdigest()}


def evaluate(facts):
    approved = [f for f in facts if f.get('status') in ('approved', 'auto_approved')]
    with EasySession(RULES_PATH.read_text()) as session:
        for f in approved:
            session.insert('fact', (f['subject'], f['predicate'], f['object']))
        return {name: sorted(set(session.snapshot(name))) for name in RELATIONS}


def run_query(kind, target, facts):
    if kind not in ('trace', 'evidence', 'missing', 'impact'):
        raise ValueError('unknown query type')
    approved = [f for f in facts if f.get('status') in ('approved', 'auto_approved')]
    rows = evaluate(approved)
    # One deterministic witness per triple; duplicate sources remain in the fact store.
    ids = {(f['subject'], f['predicate'], f['object']): f['id'] for f in reversed(approved)}
    fid = lambda s,p,o: ids[(s,p,o)]
    if kind == 'trace':
        result = {
            'documents': [{'subject': d, 'predicate': 'addresses', 'object': r, 'factId': fid(d,'addresses',r)}
                          for r,d in rows['trace_document'] if r == target],
            'templates': [{'document': d, 'template': t, 'factId': fid(d,'requires_record',t)}
                          for r,d,t in rows['trace_template'] if r == target],
            'records': [{'record': e, 'template': t, 'factId': fid(e,'instance_of',t)}
                        for r,e,t in rows['trace_record'] if r == target],
        }
    elif kind == 'evidence':
        result = [{'record': e, 'requirement': r,
                   'via': [fid(d,'addresses',r), fid(d,'requires_record',t), fid(e,'instance_of',t)]}
                  for e,r,d,t in rows['evidence_path'] if not target or r == target]
        result += [{'record': s, 'requirement': o, 'via': [fid(s,p,o)]}
                   for s,p,o in rows['direct'] if p == 'evidence_for' and (not target or o == target)]
    elif kind == 'missing':
        result = [{'requirement': r, 'document': d, 'template': t}
                  for r,d,t in rows['missing_evidence'] if not target or r == target]
    else:
        # Membership is computed by Datalog. BFS adds a short, inspectable witness path.
        members = {s for s,o in rows['impact_item'] if o == target and s != target}
        seen, queue, result = {target}, deque([(target, [])]), []
        while queue:
            node, path = queue.popleft()
            for s,p,o in rows['direct']:
                if p != 'depends_on' or o != node or s in seen: continue
                seen.add(s)
                next_path = path + [fid(s,p,o)]
                queue.append((s,next_path))
                if s in members: result.append({'node': s, 'path': next_path})
        assert {item['node'] for item in result} == members, 'missing Datalog witness'
    return {'type': kind, 'id': target, 'result': result, **engine_info(),
            'note': 'Evidence links are candidates, not conformity judgments.'}
