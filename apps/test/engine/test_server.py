"""Real HTTP transport over a loopback ephemeral port, no remote writes."""
import importlib.util
from http.client import HTTPConnection
import json
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from http.server import HTTPServer

from test_queries import engine, fixture
from test_permissions import auth_fixture


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        engine()
        spec = importlib.util.find_spec('server')
        if spec is None:
            raise AssertionError('Engine HTTP transport is not implemented')
        from server import Handler
        cls.http = HTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.http.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown(); cls.http.server_close(); cls.thread.join(timeout=3)

    def call(self, path, payload=None):
        request = Request(self.url + path, data=json.dumps(payload).encode() if payload is not None else None,
                          headers={'Content-Type': 'application/json'})
        try:
            with urlopen(request, timeout=5) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            with error:
                return error.code, json.load(error)

    def test_health_and_actual_authorization_are_exposed(self):
        status, result = self.call('/health')
        self.assertEqual(status, 200)
        self.assertEqual(result['engine']['name'], 'PyreWire')
        status, result = self.call('/authorize', auth_fixture())
        self.assertEqual(status, 200)
        self.assertTrue(result['allowed'])

    def test_context_mismatch_fails_without_success_response(self):
        data = fixture()
        request = {'snapshot': data, 'context': {**data['context'], 'dataRevision': 7},
                   'query': {'operation': 'impact', 'targetId': 'A'}}
        status, result = self.call('/query', request)
        self.assertEqual(status, 409)
        self.assertEqual(result['error']['code'], 'CONTEXT_MISMATCH')

    def test_authorization_explicitly_closes_connections_for_repeated_worker_calls(self):
        connection = HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
        try:
            for _ in range(2):
                connection.request('POST', '/authorize', body=json.dumps(auth_fixture()),
                                   headers={'Content-Type': 'application/json', 'Connection': 'keep-alive'})
                response = connection.getresponse()
                result = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertTrue(result['allowed'])
                self.assertEqual(response.getheader('Connection'), 'close')
                self.assertTrue(response.will_close)
        finally:
            connection.close()

    def test_unknown_routes_and_invalid_json_fail(self):
        status, _ = self.call('/unknown', {})
        self.assertEqual(status, 404)
        status, _ = self.call('/authorize', {})
        self.assertEqual(status, 422)


if __name__ == '__main__':
    unittest.main()
