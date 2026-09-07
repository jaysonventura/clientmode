"""Schema-contract tests only: not proof of AI skill or native tool execution.

Run: python3 -m unittest discover -s tests -p 'test_engineering_context.py' -v
Requires jsonschema; absence is an error, not a passing skipped suite.
"""
from pathlib import Path
import copy
import json
import unittest
import jsonschema

ROOT = Path(__file__).resolve().parents[1]


class EngineeringContextContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        schema = json.loads((ROOT / 'contracts/domain.schema.json').read_text())
        jsonschema.Draft202012Validator.check_schema(schema)
        cls.validator = jsonschema.Draft202012Validator(
            schema, format_checker=jsonschema.FormatChecker())
        cls.example = json.loads(
            (ROOT / 'contracts/examples/engineering-context.json').read_text())

    def setUp(self):
        self.context = copy.deepcopy(self.example)

    def assert_valid(self):
        self.assertEqual(list(self.validator.iter_errors(self.context)), [])

    def assert_invalid(self):
        self.assertGreater(len(list(self.validator.iter_errors(self.context))), 0)

    def test_polyglot_context_accepts_swift_go_python(self):
        self.assert_valid()
        self.assertEqual([c['languages'] for c in self.context['components']],
                         [['Swift'], ['Go'], ['Python']])

    def test_unfamiliar_language_is_not_whitelisted_out(self):
        c = self.context['components'][0]
        c.update(languages=['UnfamiliarFixtureLanguage'],
                 frameworks=['FixtureFramework'], domain='custom-dsl',
                 target_platforms=['FixtureHardwareTarget'])
        self.assert_valid()

    def test_no_javascript_component_is_required(self):
        c = self.context['components'][0]
        c.update(languages=['C#'], frameworks=['.NET'], target_platforms=['Windows'])
        self.context['components'] = [c]
        self.assert_valid()

    def test_grounded_without_provenance_is_rejected(self):
        self.context['components'][0]['grounding_status'] = 'GROUNDED'
        self.assert_invalid()

    def test_grounded_with_pointer_is_structurally_valid_not_proven(self):
        c = self.context['components'][0]
        c.update(grounding_status='GROUNDED', source_refs=['fixture-source-ref'])
        self.assert_valid()  # Actual reference authority must be verified by the product.

    def test_blocked_without_reason_is_rejected(self):
        c = self.context['components'][0]
        c.update(grounding_status='BLOCKED', capability_gaps=[])
        self.assert_invalid()

    def test_missing_environment_can_be_recorded_without_readiness(self):
        c = self.context['components'][0]
        c.update(grounding_status='BLOCKED', environment_ref=None,
                 capability_gaps=['Required target toolchain not available'])
        self.assert_valid()
        self.assertNotIn('verdict', self.context)

    def test_empty_components_is_rejected(self):
        self.context['components'] = []
        self.assert_invalid()

    def test_empty_required_checks_is_rejected(self):
        self.context['components'][0]['required_check_ids'] = []
        self.assert_invalid()

    def test_empty_target_platforms_is_rejected(self):
        self.context['components'][0]['target_platforms'] = []
        self.assert_invalid()

    def test_context_cannot_claim_ready_through_extra_field(self):
        self.context['verdict'] = 'VERIFIED_FOR_SCOPE'
        self.assert_invalid()

    def test_invalid_requirement_revision_is_rejected(self):
        self.context['requirements_revision'] = 0
        self.assert_invalid()

    def test_model_only_context_does_not_require_web_ui(self):
        self.context['components'] = [self.context['components'][2]]
        self.assert_valid()
        self.assertNotIn('browser', self.context['components'][0]['required_check_ids'])

    def test_data_config_component_need_not_invent_a_language(self):
        c = self.context['components'][0]
        c.update(domain='data-configuration', languages=[], frameworks=[],
                 target_platforms=['data-processing-environment'])
        self.context['components'] = [c]
        self.assert_valid()


if __name__ == '__main__':
    unittest.main()
