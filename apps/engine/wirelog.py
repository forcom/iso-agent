"""Immutable request snapshots evaluated by the canonical PyreWire rules."""
from __future__ import annotations

import base64
from collections import deque
from datetime import datetime, timezone
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import uuid

from pyrewire import EasySession

RULES_PATH = Path(os.environ.get('RULES_PATH', Path(__file__).resolve().parents[1] / 'packages/ontology/rules.dl'))
RULES = RULES_PATH.read_text(encoding='utf-8')
RULES_HASH = hashlib.sha256(RULES_PATH.read_bytes()).hexdigest()
ENGINE = {'name': 'PyreWire', 'version': version('pyrewire'), 'rulesHash': RULES_HASH}
RELATION_TYPES = {'has_revision', 'contains_clause', 'states_requirement', 'addresses', 'governed_by',
                  'requires_record_type', 'uses_template', 'record_of_type', 'evidence_candidate_for',
                  'references', 'subordinate_to', 'change_depends_on', 'about_system', 'assignment_person', 'assignment_role',
                  'policy_role', 'policy_resource_type', 'decision_on', 'receipt_for', 'supersedes'}
TRACE_TYPES = {'has_revision', 'contains_clause', 'states_requirement', 'addresses', 'governed_by',
               'requires_record_type', 'uses_template', 'record_of_type', 'evidence_candidate_for', 'about_system', 'subordinate_to'}
ACTIONS = {'read', 'create', 'revise', 'submit', 'review', 'approve', 'reject', 'circulate',
           'confirm_receipt', 'apply_assignment', 'publish'}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def context_for(request):
    context = request['context']
    if context != request['snapshot']['context']:
        raise ValueError('CONTEXT_MISMATCH')
    if context.get('rulesHash') != RULES_HASH:
        raise ValueError('RULES_MISMATCH')
    if (not isinstance(context.get('releaseId'), str) or not context['releaseId']
            or any(type(context.get(k)) is not int or context[k] < 0 for k in ('dataRevision', 'authorityRevision'))):
        raise ValueError('INVALID_CONTEXT')
    return context


def instant(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('TIMEZONE_REQUIRED')
    delta = parsed - datetime(1970, 1, 1, tzinfo=timezone.utc)
    return (delta.days * 86400 + delta.seconds) * 1000000 + delta.microseconds


def unique(items):
    result = {}
    for item in items:
        if not isinstance(item.get('id'), str) or not item['id'] or item['id'] in result:
            raise ValueError('DUPLICATE_OR_INVALID_ID')
        result[item['id']] = item
    return result


def evidence_valid(refs):
    return bool(refs) and all(isinstance(ref.get('revisionId'), str) and ref['revisionId']
        and isinstance(ref.get('sourceSha256'), str) and len(ref['sourceSha256']) == 64
        and type(ref.get('lineStart')) is int and type(ref.get('lineEnd')) is int
        and 0 < ref['lineStart'] <= ref['lineEnd'] and bool(ref.get('quote')) for ref in refs)


def health():
    # Health exercises libwirelog, not merely Python process liveness.
    with EasySession(RULES) as session:
        session.insert('seed', ['health'])
        if session.snapshot('reached') != [('health',)]:
            raise RuntimeError('ENGINE_HEALTH_FAILED')
    return {'status': 'ok', 'engine': ENGINE}


def query_graph(request):
    context = context_for(request)
    snapshot, query = request['snapshot'], request['query']
    operation = query['operation']
    if operation not in {'trace', 'neighbors', 'evidence', 'missing', 'impact'}:
        raise ValueError('UNKNOWN_QUERY')
    entities = unique(snapshot.get('entities', []))
    relations = unique(snapshot.get('relations', []))
    targets = sorted(set(query.get('targetIds', []) + ([query['targetId']] if query.get('targetId') else [])))
    if not targets:
        targets = sorted(entities)
    if any(target not in entities for target in targets):
        raise ValueError('UNKNOWN_TARGET')
    depth = query.get('depth', 1)
    if type(depth) is not int or not 1 <= depth <= 20:
        raise ValueError('INVALID_DEPTH')
    scope = {'operation': operation, 'targetIds': targets, 'depth': depth if operation == 'neighbors' else None}
    snapshot_hash = hashlib.sha256(canonical(snapshot).encode()).hexdigest()
    fingerprint = hashlib.sha256(canonical({'context': context, 'scope': scope, 'snapshot': snapshot_hash}).encode()).hexdigest()
    offset = 0
    if query.get('cursor'):
        try:
            cursor = json.loads(base64.urlsafe_b64decode(query['cursor']))
            if cursor['fingerprint'] != fingerprint or type(cursor['offset']) is not int or cursor['offset'] < 0 or cursor['offset'] % 200:
                raise ValueError('STALE_CURSOR')
            offset = cursor['offset']
        except (ValueError, KeyError, TypeError) as exc:
            raise ValueError('INVALID_OR_STALE_CURSOR') from exc
    excluded, unknown = [], []
    admitted = {}
    with EasySession(RULES) as session:
        for target in targets:
            session.insert('seed', [target])
        if operation == 'neighbors':
            session.insert('depth_limit', [depth])
        else:
            session.insert('unlimited', ['yes'])
        for entity in entities.values():
            if entity.get('type') == 'ArtifactRevision' and entity.get('metadata', {}).get('evidenceStatus', 'verified') == 'verified':
                session.insert('usable_revision', [entity['id']])
        for relation in relations.values():
            id, source, target, predicate = relation['id'], relation['subjectId'], relation['objectId'], relation['type']
            if source not in entities or target not in entities or predicate not in RELATION_TYPES:
                raise ValueError('INVALID_RELATION')
            if predicate == 'change_depends_on' and relation.get('origin') == 'reference_extraction':
                raise ValueError('REFERENCE_NOT_DEPENDENCY')
            if predicate == 'subordinate_to':
                child, parent = entities[source], entities[target]
                kinds = (child.get('metadata', {}).get('regulationType'), parent.get('metadata', {}).get('regulationType'))
                if (child.get('type') != 'ArtifactRevision' or parent.get('type') != 'ArtifactRevision'
                        or kinds not in {('procedure', 'manual'), ('guide', 'procedure')}
                        or relation.get('origin') != 'regulation'):
                    raise ValueError('INVALID_HIERARCHY')
            reason = None
            if relation.get('releaseId') != context['releaseId']:
                raise ValueError('RELATION_RELEASE_MISMATCH')
            if relation.get('reviewStatus') != 'validated':
                reason = 'RELATION_NOT_VALIDATED'
            elif relation.get('evidenceStatus', 'verified') != 'verified':
                reason = 'SOURCE_' + relation['evidenceStatus'].upper()
            elif not evidence_valid(relation.get('evidenceRefs')) and relation.get('origin') != 'product_policy':
                reason = 'EVIDENCE_UNRECORDED'
            elif relation.get('conditionStatus') == 'not_met':
                reason = 'CONDITION_NOT_MET'
            elif relation.get('conditionStatus') == 'unknown' or (relation.get('condition') and not relation.get('conditionStatus')):
                unknown.append({'id': id, 'reason': relation.get('condition') or 'CONDITION_UNKNOWN'})
                reason = 'CONDITION_UNKNOWN'
            if reason:
                excluded.append({'id': id, 'reason': reason})
                continue
            admitted[id] = relation
            if predicate == 'requires_record_type':
                session.insert('required', [id, source, target])
            elif predicate == 'record_of_type':
                session.insert('record_type', [source, target])
            elif predicate == 'has_revision' and entities[source].get('type') == 'Record':
                session.insert('record_revision', [source, target])
            elif predicate == 'evidence_candidate_for':
                session.insert('direct_candidate', [source, target])
            include = operation == 'neighbors' or predicate in TRACE_TYPES
            if operation == 'impact':
                include = predicate == 'change_depends_on'
            if include:
                session.insert('edge', [id, source, target])
                session.insert('step', [target, source])
                if operation != 'impact':
                    session.insert('step', [source, target])
        selected = {row[0] for row in session.snapshot('selected_edge')}
        reached = {row[0] for row in session.snapshot('reached')}
        missing_rows = session.snapshot('missing_required') if operation == 'missing' else []
        candidates = session.snapshot('candidate') if operation in {'trace', 'evidence', 'missing'} else []
    full_relations = sorted((admitted[id] for id in selected), key=lambda item: item['id'])
    page = full_relations[offset:offset + 200]
    if offset > len(full_relations):
        raise ValueError('INVALID_CURSOR_OFFSET')
    page_nodes = set(targets) if not page else set()
    for relation in page:
        page_nodes.update((relation['subjectId'], relation['objectId']))
    next_cursor = None
    if offset + len(page) < len(full_relations):
        next_cursor = base64.urlsafe_b64encode(canonical({'fingerprint': fingerprint, 'offset': offset + 200}).encode()).decode()
    missing = [{'recordTypeId': typ, 'condition': admitted[id].get('condition', ''), 'status': 'missing'} for id, typ in missing_rows]
    result = {'queryId': str(uuid.uuid4()), 'context': context, 'operation': operation, 'targetIds': targets,
              'computedAt': datetime.now(timezone.utc).isoformat(), 'engine': ENGINE,
              'entities': [entities[id] for id in sorted(page_nodes)], 'relations': page,
              'totalEntities': len(reached), 'totalRelations': len(full_relations), 'cursor': next_cursor,
              'displayRange': {'start': offset, 'end': offset + len(page)},
              'paths': finite_paths(targets, full_relations, operation), 'excluded': excluded, 'unknown': unknown,
              'missing': missing, 'evidenceCandidates': [{'revisionId': v, 'targetId': t} for v, t in candidates if t in reached]}
    if operation == 'impact':
        result['impactSet'] = sorted(reached - set(targets))
    return result


def finite_paths(targets, relations, operation):
    """One finite witness per edge retains alternatives without enumerating cycles."""
    adjacency = {}
    for relation in relations:
        source, target = relation['subjectId'], relation['objectId']
        adjacency.setdefault(target, []).append((source, relation['id']))
        if operation != 'impact':
            adjacency.setdefault(source, []).append((target, relation['id']))
    paths = {target: ([target], []) for target in targets}
    queue = deque(targets)
    witnesses = []
    emitted = set()
    while queue:
        current = queue.popleft()
        nodes, ids = paths[current]
        for neighbor, relation_id in adjacency.get(current, []):
            if relation_id not in emitted:
                witnesses.append({'nodeIds': nodes + [neighbor], 'relationIds': ids + [relation_id], 'derived': bool(ids)})
                emitted.add(relation_id)
            if neighbor not in paths:
                paths[neighbor] = (nodes + [neighbor], ids + [relation_id])
                queue.append(neighbor)
    return witnesses


def authorize(request):
    context = context_for(request)
    actor, resource, snapshot = request['actor'], request['resource'], request['snapshot']
    action = request['action']
    if action not in ACTIONS:
        raise ValueError('UNKNOWN_ACTION')
    now = instant(request.get('now') or datetime.now(timezone.utc).isoformat())
    policies, assignments = unique(snapshot.get('policies', [])), unique(snapshot.get('assignments', []))
    type_ids = resource.get('typeIds', [])
    reasons = []
    with EasySession(RULES) as session:
        def insert(name, *values):
            session.insert(name, list(values))
        if actor.get('active') is True:
            insert('actor', actor['personId'], now)
        insert('requested', action)
        if actor.get('isAdmin') is True:
            insert('is_admin', actor['personId'])
        for typ in type_ids:
            insert('required_type', typ)
        insert('resource', resource.get('id') or '')
        insert('target_state', resource['state'])
        for system in resource.get('systemIds', []):
            insert('target_system', system)
        if resource.get('ownerPersonId'):
            insert('target_owner', resource['ownerPersonId'])
        for recipient in resource.get('recipientPersonIds', []):
            insert('recipient', recipient)
        if resource.get('revisionId') and resource['revisionId'] == resource.get('currentRevisionId'):
            insert('exact_revision', 'yes')
        for field, value in resource.get('conditions', {}).items():
            if type(value) not in (str, int, float, bool):
                raise ValueError('INVALID_CONDITION_VALUE')
            insert('observed', field, canonical(value))
        for separation, field in [('not_author', 'authorPersonId'), ('not_requester', 'requesterPersonId'), ('not_reviewer', 'reviewerPersonIds'),
                                  ('not_implementer', 'implementerIds'), ('independent_auditor', 'auditedPersonIds')]:
            if field in resource and resource[field] is not None and resource[field] != '':
                insert('known_separation', separation)
                people = resource[field] if isinstance(resource[field], list) else [resource[field]]
                for person in people:
                    if person:
                        insert('person_conflict', separation, person)
        for assignment in assignments.values():
            id = assignment['id']
            # Delegation is out of scope, so no `delegated` fact is emitted and its rules.dl rule stays inert.
            # Remove that rule with the next rules change: editing rules.dl changes RULES_HASH and needs a knowledge reinstall.
            if assignment.get('delegatedFromAssignmentId'):
                reasons.append({'id': id, 'reason': 'DELEGATION_NOT_SUPPORTED'})
                continue
            if assignment.get('status') != 'active' or not assignment.get('approvedRevisionId') or not evidence_valid(assignment.get('evidenceRefs')):
                reasons.append({'id': id, 'reason': 'ASSIGNMENT_NOT_VERIFIED'})
                continue
            start = instant(assignment['validFrom'])
            end = instant(assignment['validUntil']) if assignment.get('validUntil') else 253402300799999999
            if end <= start:
                raise ValueError('INVALID_ASSIGNMENT_PERIOD')
            scope = assignment['scope']
            if scope['kind'] not in {'all', 'system', 'resource'}:
                raise ValueError('INVALID_ASSIGNMENT_SCOPE')
            insert('assignment', id, assignment['personId'], assignment['roleId'], start, end)
            insert('assignment_scope', id, scope['kind'])
            for value in scope['ids']:
                insert('assignment_scope_id', id, value)
            insert('assignment_root', id)
        for policy in policies.values():
            id = policy['id']
            product_policy = policy.get('origin') == 'product_policy' and any(
                item.get('id') == policy.get('productPolicyId') and item.get('origin') == 'product_policy'
                and item.get('sourceUrl') and item.get('decision') for item in snapshot.get('productPolicies', []))
            if (policy.get('reviewStatus') != 'validated' or policy.get('effectiveReleaseId') != context['releaseId']
                    or not (evidence_valid(policy.get('evidenceRefs')) or product_policy)):
                reasons.append({'id': id, 'reason': 'POLICY_NOT_VERIFIED'})
                continue
            if policy['scopeCondition']['kind'] not in {'all', 'system', 'owner', 'recipient'}:
                raise ValueError('INVALID_POLICY_SCOPE')
            if policy['separationCondition'] not in {'none', 'not_author', 'not_requester', 'not_reviewer', 'not_implementer', 'independent_auditor'}:
                raise ValueError('INVALID_SEPARATION')
            if product_policy and policy.get('adminRequired') is True and policy['action'] in {'publish', 'apply_assignment'}:
                insert('product_admin_policy', id)
            insert('policy', id, policy['resourceTypeId'], policy['action'], policy['roleId'], policy['separationCondition'])
            insert('policy_scope', id, policy['scopeCondition']['kind'])
            insert('policy_admin', id, 'yes' if policy.get('adminRequired') else 'no')
            insert('policy_exact', id, 'yes' if policy.get('requiresExactRevision') else 'no')
            for state in policy['stateCondition']:
                insert('policy_state', id, state)
            for system in policy['scopeCondition'].get('systemIds', []):
                insert('policy_system', id, system)
            for condition in policy.get('conditions', []):
                insert('policy_condition', id, condition['field'], canonical(condition['equals']))
            for field, value in policy['scopeCondition'].get('conditions', {}).items():
                insert('policy_condition', id, field, canonical(value))
        allowed_rows = session.snapshot('allowed')
        common = {row[0] for row in session.snapshot('common_permission')}
    covered = {row[0] for row in allowed_rows}
    allowed = action in common or (bool(type_ids) and set(type_ids) <= covered)
    policy_ids = sorted({row[1] for row in allowed_rows}) if allowed else []
    return {'allowed': allowed, 'reason': 'ALLOWED' if allowed else 'NO_VALID_POLICY_ASSIGNMENT_OR_CONDITION',
            'policyIds': policy_ids, 'assignmentIds': sorted({row[2] for row in allowed_rows if row[2]}) if allowed else [],
            'context': context, 'engine': ENGINE,
            'evidenceRefs': [ref for id in policy_ids for ref in policies[id]['evidenceRefs']],
            'excluded': reasons, 'uncoveredTypeIds': sorted(set(type_ids) - covered)}
