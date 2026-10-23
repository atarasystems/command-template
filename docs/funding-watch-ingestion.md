# Funding Watch ingestion contract

Funding Watch tools use the authenticated `POST /api/opportunities/watch` endpoint. The caller sends the normal Command session cookie; the endpoint is not public and never exposes service credentials. Both watches use this same contract and database source.

```json
{
  "program_name": "NSF SBIR/STTR Phase I",
  "organization": "U.S. National Science Foundation",
  "official_url": "https://example.gov/program",
  "opportunity_type": "grant",
  "funding_value_text": "Up to $305,000",
  "funding_min_amount": 0,
  "funding_max_amount": 305000,
  "funding_structure": "grant",
  "is_non_dilutive": true,
  "equity_percent": null,
  "equity_terms_text": "No equity; applicant retains ownership/IP",
  "deadline": "2026-11-04T23:59:59Z",
  "eligibility": "Verified eligibility summary",
  "application_requirements": {"technical_narrative": true, "budget": true},
  "fit_label": "very_high",
  "fit_rationale": "Direct fit for the company's technical-feasibility R&D.",
  "priority_label": "HIGH PRIORITY",
  "priority_rank": 1,
  "effort_min_hours": 20,
  "effort_max_hours": 35,
  "effort_level": "major",
  "effort_rationale": "Major proposal with technical narrative, budget, and registrations.",
  "reuse_level": "high",
  "required_partners": null,
  "source_verified_at": "2026-09-13T12:00:00Z",
  "external_program_id": "optional-source-id"
}
```

New records are created with `funding_intent = option`, `status = discovered`, and no application or Work item. Existing records are matched first by normalized official URL, then external program ID, then normalized program name plus organization. Current intent, lifecycle status, explicit score inputs, notes, linked applications, and Work items are preserved on updates. A `chosen` or submitted record is never demoted. Low-fit payloads are skipped; unknown fields remain null.
