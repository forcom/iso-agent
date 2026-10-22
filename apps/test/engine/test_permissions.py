"""Authorization against actual PyreWire with synthetic role evidence."""
import copy
import unittest
from test_queries import engine, fixture


def auth_fixture():
    evidence = fixture()['relations'][0]['evidenceRefs']
    context = fixture()['context']
    policy = dict(id='policy-approve', resourceTypeId='type-1', action='approve', roleId='technical',
                  scopeCondition={'kind': 'all'}, stateCondition=['reviewed'], separationCondition='not_author',
                  decisionKind='approval', evidenceRefs=evidence, effectiveReleaseId=context['releaseId'],
                  origin='regulation', conditions=[], requiresExactRevision=True, reviewStatus='validated')
    assignment = dict(id='assignment-technical', personId='p1', roleId='technical',
                      scope={'kind': 'system', 'ids': ['system-1']}, validFrom='2026-01-01T00:00:00Z',
                      validUntil='2027-01-01T00:00:00Z', approvedRevisionId='designation-1',
                      evidenceRefs=evidence, status='active')
    return {'context': context, 'snapshot': {'context': context, 'policies': [policy], 'assignments': [assignment]},
            'actor': {'personId': 'p1', 'active': True, 'isAdmin': False}, 'action': 'approve',
            'resource': {'id': 'record-1', 'typeIds': ['type-1'], 'revisionId': 'r1', 'currentRevisionId': 'r1',
                         'state': 'reviewed', 'systemIds': ['system-1'], 'authorPersonId': 'p2', 'conditions': {}},
            'now': '2026-10-23T10:00:00Z'}


class PermissionTests(unittest.TestCase):
    def test_type_scope_is_checked_for_every_type_in_combined_record(self):
        request = auth_fixture()
        result = engine().authorize(request)
        self.assertTrue(result['allowed'])
        self.assertEqual(result['policyIds'], ['policy-approve'])
        request['resource']['typeIds'].append('type-2')
        self.assertFalse(engine().authorize(request)['allowed'])

    def test_period_scope_state_revision_and_real_separation_are_enforced(self):
        mutations = [
            lambda r: r.update(now='2027-01-01T00:00:00Z'),
            lambda r: r['resource'].update(systemIds=['other-system']),
            lambda r: r['resource'].update(authorPersonId='p1'),
            lambda r: r['resource'].update(authorPersonId=None),
            lambda r: r['resource'].update(state='draft'),
            lambda r: r['resource'].update(currentRevisionId='r2'),
            lambda r: r['snapshot']['assignments'][0].update(status='revoked'),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                request = auth_fixture(); mutate(request)
                self.assertFalse(engine().authorize(request)['allowed'])
        request = auth_fixture()
        request['snapshot']['policies'][0]['separationCondition'] = 'none'
        request['resource']['authorPersonId'] = 'p1'
        self.assertTrue(engine().authorize(request)['allowed'])

    def test_assignment_subsecond_effective_time_is_not_rounded_down(self):
        request = auth_fixture()
        request['snapshot']['assignments'][0]['validFrom'] = '2026-10-23T10:00:00.500000Z'
        request['now'] = '2026-10-23T10:00:00.499999Z'
        self.assertFalse(engine().authorize(request)['allowed'])
        request['now'] = '2026-10-23T10:00:00.500000Z'
        self.assertTrue(engine().authorize(request)['allowed'])

    def test_explicit_product_administrator_policy_cannot_grant_regulatory_approval(self):
        request = auth_fixture()
        request['actor']['isAdmin'] = True
        request['action'] = 'apply_assignment'
        request['resource']['state'] = 'approved'
        request['snapshot']['assignments'] = []
        request['snapshot']['productPolicies'] = [{'id': 'admin-publication', 'origin': 'product_policy',
                                                 'sourceUrl': 'https://example.invalid/decision', 'decision': 'Synthetic operator policy'}]
        policy = request['snapshot']['policies'][0]
        policy.update(action='apply_assignment', roleId='administrator', origin='product_policy',
                      productPolicyId='admin-publication', adminRequired=True, evidenceRefs=[],
                      stateCondition=['approved'], separationCondition='none')
        self.assertTrue(engine().authorize(request)['allowed'])
        request['actor']['isAdmin'] = False
        self.assertFalse(engine().authorize(request)['allowed'])
        request['actor']['isAdmin'] = True
        request['action'] = 'approve'; policy['action'] = 'approve'
        self.assertFalse(engine().authorize(request)['allowed'])
        request['action'] = 'apply_assignment'; policy['action'] = 'apply_assignment'
        request['snapshot']['productPolicies'] = []
        self.assertFalse(engine().authorize(request)['allowed'])

    def test_access_approval_separates_requester_from_approver_not_uploader(self):
        request = auth_fixture()
        request['snapshot']['policies'][0]['separationCondition'] = 'not_requester'
        self.assertFalse(engine().authorize(request)['allowed'])
        request['resource']['requesterPersonId'] = 'p1'
        self.assertFalse(engine().authorize(request)['allowed'])
        request['resource']['requesterPersonId'] = 'p2'
        request['resource']['authorPersonId'] = 'p1'
        self.assertTrue(engine().authorize(request)['allowed'])

    def test_admin_mode_does_not_grant_regulatory_decision(self):
        request = auth_fixture(); request['actor']['isAdmin'] = True
        request['snapshot']['assignments'] = []
        self.assertFalse(engine().authorize(request)['allowed'])

    def test_conditions_unknown_are_denied_and_required_exact_values_apply(self):
        request = auth_fixture()
        request['snapshot']['policies'][0]['conditions'] = [
            {'field': 'escalation', 'equals': False, 'reason': 'Synthetic escalation',
             'evidenceRefs': fixture()['relations'][0]['evidenceRefs']}]
        self.assertFalse(engine().authorize(request)['allowed'])
        request['resource']['conditions']['escalation'] = False
        self.assertTrue(engine().authorize(request)['allowed'])
        request['resource']['conditions']['escalation'] = 'false'
        self.assertFalse(engine().authorize(request)['allowed'])

    def test_delegation_does_not_expand_parent_scope_or_expiry(self):
        request = auth_fixture(); parent = request['snapshot']['assignments'][0]
        parent['personId'] = 'principal'
        child = copy.deepcopy(parent)
        child.update(id='delegated', personId='p1', delegatedFromAssignmentId=parent['id'])
        child['scope'] = {'kind': 'all', 'ids': []}
        request['snapshot']['assignments'].append(child)
        self.assertTrue(engine().authorize(request)['allowed'])
        request['resource']['systemIds'] = ['unrelated']
        self.assertFalse(engine().authorize(request)['allowed'])
        request['resource']['systemIds'] = ['system-1']
        parent['validUntil'] = '2026-06-01T00:00:00Z'
        self.assertFalse(engine().authorize(request)['allowed'])

    def test_delegation_cycle_or_unapproved_assignment_cannot_authorize(self):
        request = auth_fixture()
        assignment = request['snapshot']['assignments'][0]
        assignment['delegatedFromAssignmentId'] = assignment['id']
        self.assertFalse(engine().authorize(request)['allowed'])
        del assignment['delegatedFromAssignmentId']
        assignment['evidenceRefs'] = []
        self.assertFalse(engine().authorize(request)['allowed'])

    def test_receipt_requires_selected_recipient_and_exact_revision(self):
        request = auth_fixture(); request['action'] = 'confirm_receipt'
        request['resource']['recipientPersonIds'] = ['p2']
        self.assertFalse(engine().authorize(request)['allowed'])
        request['resource']['recipientPersonIds'] = ['p1']
        self.assertTrue(engine().authorize(request)['allowed'])
        request['resource']['currentRevisionId'] = 'r2'
        self.assertFalse(engine().authorize(request)['allowed'])


if __name__ == '__main__':
    unittest.main()
