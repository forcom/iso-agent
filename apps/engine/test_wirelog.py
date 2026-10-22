import unittest
from pathlib import Path

from pyrewire import EasySession
from wirelog import run_query


class WirelogRulesTest(unittest.TestCase):
    def test_actual_datalog_trace_evidence_missing_impact_and_permissions(self):
        rules = (Path(__file__).resolve().parents[2] / "packages/ontology/rules.dl").read_text()
        try:
            session = EasySession(rules)
        except Exception as exc:
            self.fail(f"Canonical rules must compile in PyreWire: {exc}")
        with session:
            rows = [
                ("doc:p", "addresses", "req:1"),
                ("doc:p", "requires_record", "tpl:present"),
                ("doc:p", "requires_record", "tpl:missing"),
                ("record:r", "instance_of", "tpl:present"),
                ("doc:p", "depends_on", "doc:manual"),
                ("doc:guide", "depends_on", "doc:p"),
                ("person:p", "holds_role", "role:r"),
                ("role:r", "grants", "perm:read"),
            ]
            for row in rows:
                session.insert("fact", row)
            self.assertIn(("record:r", "req:1"), session.snapshot("evidence_candidate"))
            self.assertEqual(session.snapshot("missing_evidence"), [("req:1", "doc:p", "tpl:missing")])
            self.assertIn(("doc:guide", "doc:manual"), session.snapshot("impact_item"))
            self.assertEqual(session.snapshot("has_permission"), [("person:p", "perm:read")])
            self.assertEqual(session.snapshot("trace_record"), [("req:1", "record:r", "tpl:present")])

    def test_query_excludes_drafts_and_keeps_fact_witnesses(self):
        triples = [('doc:p', 'addresses', 'req:1'), ('doc:p', 'requires_record', 'tpl:t'),
                   ('record:r', 'instance_of', 'tpl:t'), ('doc:g', 'depends_on', 'doc:p'),
                   ('doc:draft', 'depends_on', 'doc:p')]
        facts = [dict(id=f'f{i}', subject=s, predicate=p, object=o,
                      status='draft' if i == 4 else 'auto_approved' if i == 2 else 'approved')
                 for i, (s,p,o) in enumerate(triples)]
        evidence = run_query('evidence', 'req:1', facts)
        self.assertEqual(evidence['engine'], 'pyrewire')
        self.assertEqual(evidence['result'], [{'record': 'record:r', 'requirement': 'req:1', 'via': ['f0','f1','f2']}])
        self.assertEqual(run_query('impact','doc:p',facts)['result'], [{'node': 'doc:g', 'path': ['f3']}])
        self.assertEqual(run_query('missing','req:1',facts)['result'], [])


if __name__ == "__main__":
    unittest.main()
