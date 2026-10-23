"""Synthetic graphs only; no operational corpus or existing local databases."""
import copy
import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'apps/engine'))


def engine():
    spec = importlib.util.find_spec('wirelog')
    if spec is None:
        raise AssertionError('The actual PyreWire engine is not implemented')
    import wirelog
    return wirelog


def fixture():
    return {'context': {'releaseId': 'synthetic-release', 'dataRevision': 1,
                        'authorityRevision': 2, 'rulesHash': engine().RULES_HASH},
            'entities': [{'id': x, 'type': 'ArtifactRevision', 'label': x} for x in 'ABCDE'],
            'relations': [relation('ab', 'B', 'A'), relation('ac', 'C', 'A'),
                          relation('bd', 'D', 'B'), relation('cd', 'D', 'C'),
                          relation('da', 'A', 'D'), relation('ea', 'E', 'A', 'references')]}


def relation(id, subject, obj, predicate='change_depends_on', **extra):
    return dict(id=id, subjectId=subject, objectId=obj, type=predicate,
                origin='explicit_metadata', releaseId='synthetic-release',
                reviewStatus='validated', evidenceStatus='verified',
                evidenceRefs=[{'revisionId': 'synthetic-source', 'sourceSha256': 'a' * 64,
                               'lineStart': 1, 'lineEnd': 1, 'quote': 'Synthetic evidence.'}], **extra)


def query(snapshot, kind='impact', **kwargs):
    return engine().query_graph({'context': snapshot['context'], 'snapshot': snapshot,
                                 'query': {'operation': kind, 'targetId': 'A', **kwargs}})


class GraphTests(unittest.TestCase):
    def test_regulation_hierarchy_is_traced_without_transferring_evidence_or_impact(self):
        data = fixture()
        data['entities'] = [dict(id=id, type='ArtifactRevision', label=id,
                                 metadata={'artifactKind': 'regulation', 'regulationType': kind})
                            for id, kind in [('A', 'manual'), ('B', 'procedure'), ('C', 'guide')]]
        data['relations'] = [relation('procedure-manual', 'B', 'A', 'subordinate_to'),
                             relation('guide-procedure', 'C', 'B', 'subordinate_to')]
        for item in data['relations']:
            item['origin'] = 'regulation'
        result = query(data, 'trace')
        self.assertEqual({r['id'] for r in result['relations']}, {'procedure-manual', 'guide-procedure'})
        self.assertEqual(query(data, 'neighbors', depth=1)['totalRelations'], 1)
        self.assertEqual(query(data, 'neighbors', depth=2)['totalRelations'], 2)
        self.assertEqual(query(data, 'impact')['relations'], [])
        self.assertEqual(result['evidenceCandidates'], [])
        data['relations'][1]['objectId'] = 'A'
        with self.assertRaisesRegex(ValueError, 'INVALID_HIERARCHY'):
            query(data, 'trace')

    def test_references_do_not_become_dependencies_and_cycles_preserve_all_paths(self):
        result = query(fixture())
        self.assertEqual({r['id'] for r in result['relations']}, {'ab', 'ac', 'bd', 'cd', 'da'})
        self.assertEqual({n['id'] for n in result['entities']}, {'A', 'B', 'C', 'D'})
        self.assertEqual(result['engine']['name'], 'PyreWire')
        self.assertEqual(result['engine']['version'], '1.1.2')
        self.assertTrue(result['paths'])

    def test_multiple_sources_for_same_triple_survive(self):
        data = fixture()
        duplicate = copy.deepcopy(data['relations'][0]); duplicate['id'] = 'ab-other'
        duplicate['evidenceRefs'][0]['revisionId'] = 'another-source'
        data['relations'].append(duplicate)
        self.assertEqual(len(query(data)['relations']), 6)

    def test_cursor_pages_200_relations_and_rejects_stale_or_altered_scope(self):
        data = fixture()
        data['entities'] = [{'id': 'A', 'type': 'ArtifactRevision', 'label': 'A'}]
        data['relations'] = []
        for i in range(205):
            id = f'n{i:03}'
            data['entities'].append({'id': id, 'type': 'ArtifactRevision', 'label': id})
            data['relations'].append(relation(f'r{i:03}', id, 'A'))
        first = query(data)
        self.assertEqual(first['totalRelations'], 205)
        self.assertEqual(len(first['relations']), 200)
        second = query(data, cursor=first['cursor'])
        self.assertEqual(len(second['relations']), 5)
        self.assertIsNone(second.get('cursor'))
        with self.assertRaisesRegex(ValueError, 'CURSOR'):
            query(data, 'neighbors', cursor=first['cursor'])
        data['context']['dataRevision'] += 1
        with self.assertRaisesRegex(ValueError, 'CURSOR'):
            query(data, cursor=first['cursor'])

    def test_context_and_rules_mismatch_fail(self):
        data = fixture()
        request = {'context': copy.deepcopy(data['context']), 'snapshot': data,
                   'query': {'operation': 'impact', 'targetId': 'A'}}
        request['context']['authorityRevision'] += 1
        with self.assertRaisesRegex(ValueError, 'CONTEXT'):
            engine().query_graph(request)
        data['context']['rulesHash'] = 'b' * 64
        with self.assertRaisesRegex(ValueError, 'RULES'):
            query(data)

    def test_unverified_dependencies_are_excluded_with_reason(self):
        data = fixture(); data['relations'][0]['evidenceStatus'] = 'changed'
        result = query(data)
        self.assertNotIn('ab', {r['id'] for r in result['relations']})
        self.assertTrue(any(x['id'] == 'ab' for x in result['excluded']))

    def test_evidence_uses_explicit_type_path_without_transitive_candidate_inference(self):
        data = fixture()
        data['entities'] = [dict(id=id, type=typ, label=id) for id, typ in [
            ('A', 'ActivityDefinition'), ('T', 'RecordType'), ('R', 'Record'),
            ('V', 'ArtifactRevision'), ('Q', 'Requirement')]]
        data['relations'] = [relation('required', 'A', 'T', 'requires_record_type'),
                             relation('type', 'R', 'T', 'record_of_type'),
                             relation('version', 'R', 'V', 'has_revision'),
                             relation('addresses', 'A', 'Q', 'addresses')]
        result = query(data, 'evidence')
        self.assertEqual(result['evidenceCandidates'], [{'revisionId': 'V', 'targetId': 'A'}])
        self.assertEqual(query(data, 'missing')['missing'], [])
        data['entities'][3]['metadata'] = {'evidenceStatus': 'unavailable'}
        self.assertEqual(query(data, 'evidence')['evidenceCandidates'], [])
        self.assertEqual(query(data, 'missing')['missing'][0]['recordTypeId'], 'T')

    def test_reference_extraction_is_not_valid_dependency_origin(self):
        data = fixture()
        data['relations'][0]['origin'] = 'reference_extraction'
        with self.assertRaisesRegex(ValueError, 'REFERENCE_NOT_DEPENDENCY'):
            query(data)

    def test_unknown_applicability_is_not_missing(self):
        data = fixture()
        data['entities'] = [dict(id='A', type='ActivityDefinition', label='Activity'),
                            dict(id='T', type='RecordType', label='Form')]
        data['relations'] = [relation('required', 'A', 'T', 'requires_record_type', conditionStatus='unknown')]
        result = query(data, 'missing')
        self.assertEqual(result['missing'], [])
        self.assertEqual(len(result['unknown']), 1)
        data['relations'][0]['conditionStatus'] = 'met'
        self.assertEqual(query(data, 'missing')['missing'][0]['recordTypeId'], 'T')


if __name__ == '__main__':
    unittest.main()
