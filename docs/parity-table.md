# MCP ↔ HTTP parity table

Maps every WebCite MCP tool to its HTTP route, request fields, output shape,
failure/partial semantics, credit cost, and source-identity rules.

Scope always comes from the authenticated WebCite API key. MCP annotations
(`readOnlyHint`, `idempotentHint`, etc.) are descriptive only and never supply
tenant or permission scope.

---

## v1 tools (existing)

| MCP tool | HTTP | Request fields | Output | Failure / partial | Credits | Source identity |
|---|---|---|---|---|---|---|
| `verify_claim` | `POST /api/v1/verify` | `claim`, optional `thread_id`, stance/verdict/decompose flags | Verdict + citations (text) | API error → `isError` | 2–4 | Citation IDs from API |
| `verify_claim_stream` | `POST /api/v1/verify/stream` | same as verify | Assembled verify result or raw events | Stream/API error → `isError` | same | same |
| `search_sources` | `POST /api/v1/sources/search` | `query`, `limit` | Citation list; empty = no sources | API error → `isError` | 2 | Citation IDs |
| `list_citations` | `GET /api/v1/citations` | `page`, `limit`, `thread_id` | Paginated history | API error → `isError` | 1 | Citation record IDs |
| `get_citation` | `GET /api/v1/citations/:id` | `citation_id` | Prompt + sources | 404 → `isError` | 1 | Citation ID |
| `get_source_preview` | `POST /api/v1/citations/source-preview` | `url` or `asset_id`, `page`, `quote` | Preview + bindBack | Missing arg / API error | 1 | URL or asset ID + binding method |
| `verify_batch` | `POST /api/v1/verify/batch` | `items[]` (quote + source) | Per-item binding + `feedback_token` | Invalid items / API error | 1/item | Per-item source + feedback token |
| `verify_feedback` | `POST /api/v1/verify/feedback` | `token`, `verdict`, `note` | Recorded ack | Invalid verdict / API error | 1 | Feedback token identity |
| `analyze_conflicts` | `POST /api/v1/analyze/conflicts` | `figures[]` | Conflicts, recomputes, review | Empty figures / API error | 1 | Figure provenance (`assetId`, cell, page) |
| `analyze_document` | `POST /api/v1/analyze/document` | `asset_id` | Figures + analysis + category | API error | 3 | Asset ID + provenance |
| `classify_document` | `POST /api/v1/classify` | `asset_id` or `asset_url`, `taxonomy` | `category`, `covers` | Missing asset ref | 1 | Asset ID/URL |
| `document_gaps` | `POST /api/v1/gaps` | `category`, `docs`, `taxonomy`, `stage` | Present/absent checklist | Missing category | 1 | Filename/category/covers (advisory) |
| `extract_document` | `POST /api/v1/extract` | `asset_id` or `asset_url` | Markdown + units (truncated in text) | Missing asset ref | 1 | Asset + page/sheet provenance |
| `extract_figures` | `POST /api/v1/extract/figures` | `asset_id` or `asset_url` | Tagged figures | Missing asset ref | 2 | Cell/page provenance |
| `accuracy_report` | `GET /api/v1/accuracy` | (none) | Measured detection/recompute rates | API error | 1 | Gold-set corpus (no caller sources) |
| `upload_file` | `POST /api/v1/upload` | `file_path` (local) | `file_id` | Missing path / upload error | 1 | Returned `file_id` |

---

## Context / evidence tools (W1, v2)

| MCP tool | HTTP | Request fields | Output (text + `structuredContent`) | Failure / partial / no-match | Credits | Source identity |
|---|---|---|---|---|---|---|
| `get_answer` | `GET /api/v2/answers/:revisionId` | non-blank unpadded `revision_id` | Sealed answer text, packet IDs/hashes, presentation refs, freshness | Blank/padded → `incomplete_answer_revision_identity` (#264/#279); unknown/unauthorized → `not_found`/`unauthorized`; integrity → `integrity_error`; invalid body → `invalid_api_output`. Never regenerates or trim-launders. | 1 | `answer.revisionId` + `contentHash`; input/output packet IDs + hashes |
| `get_evidence_packet` | `GET /api/v2/evidence-packets/:id` | non-blank unpadded `packet_id` | Sealed packet + presentation refs | Blank/padded → `incomplete_packet_identity` (#264/#279); same integrity as above; zero extraction on resolve; never trim-launders | 1 | `packet.id` + `contentHash` |
| `query_context` | `POST /api/v2/context/query` | non-blank unpadded `text`, optional `source_texts`, `source_version_ids`, non-blank unpadded `filters`, `max_hops`, `limit`, `idempotency_key` | `status`, operator, refs, gaps, presentation | **Successful no-match:** `status: refuse` / empty refs, `isError` false. Blank/whitespace/surrounding-padded `text` → `padded_select_text` (#314; never trim-launder). API `gaps: [padded_select_text]` → `invalid_api_output` (never certified refuse). Blank/padded filters → `padded_lookup_filter` (#307). Other invalid args → `invalid_argument`. Malformed API → `invalid_api_output`. | 1 | `sourceVersionId` + `nodeId` (presentation numbers are display-only) |
| `compare_assertions` | `POST /api/v2/context/compare-assertions` | `left`, `right` claim scopes (non-blank unpadded string fields); optional `idempotency_key` | `result`: `same` \| `different` \| `unknown` | `unknown` is not contradiction. Missing scopes → `invalid_argument`. Blank/whitespace/surrounding-padded scope fields → `padded_compare_filter` (never trim-launder equal pads into same/different). | 1 | Scope field equality; unknown fields stay unknown |
| `get_change_impact` | `POST /api/v2/context/change-impact` | `answer_revision_id` and/or `changed_ids` (+ optional `packet_id`, `links`, `observed_at_ms`, `window`); optional `idempotency_key` | Freshness and/or packet_impact (affected consumers, coverage) | Historical answer stays sealed. Blank/whitespace/padded `answer_revision_id` → `incomplete_answer_revision_identity`; blank/whitespace/padded `packet_id` → `incomplete_packet_identity` (never trim-launder; W3 #264/#279). Blank/whitespace/padded `changed_ids` → `incomplete_changed_ids`. Blank/whitespace/padded link `source_id`/`consumer_id` → `incomplete_dependency_graph`. `source_id === consumer_id` → `self_loop_dependency`. Incomplete sealed-packet / dependency graph / self-loop → `change_impact_incomplete` (fail-closed). Undetermined freshness coverage reported, not silent “no changes”. | 1 | Answer revision ID; source version IDs; packet consumer ids |
| `create_evidence_packet` | `POST /api/v2/context/evidence-packets` | `claim_text`, `bindings[]` (non-blank unpadded `source_version_id` / `source_unit_id` / `representation_id`, optional snippet/seed), optional `operator_class`, `idempotency_key` | `packet_id`, optional `content_hash` / `input_packet_id`, gaps | Empty claim/bindings → `invalid_argument`. Blank/whitespace/surrounding-padded binding ids → `incomplete_binding_identity` (#264/#279; never trim-launder). Retries must reuse `idempotency_key`. Client cannot supply a certified sealed payload. | 2 | Returned `packet_id` (+ hash when present) |
| `number_inventory` | `POST /api/v2/context/numbers/inventory` | `occurrences[]` with `recognition_state`, non-blank unpadded `raw`, explicit unpadded `method` (never defaulted to `native`); optional `idempotency_key` | `counts` (read/uncertain/unreadable), `coverage`, `occurrences`, `unresolved` | Incomplete identity (blank/whitespace/padded id/fragment_id)/raw (blank/padded)/blank_normalized_decimal (blank/padded)/method/interpretation/recognition (invalid or surrounding-padded) or unreadable+decimal → API `number_inventory_incomplete` → `api_error`. Missing `occurrences` → `invalid_argument`. | 1 | Occurrence id (dedupe); not raw magnitude |
| `find_contradictions` | `POST /api/v2/context/contradictions` | `claims[]` with `interval` (`from`/`to`) + `decimal_value`; optional `idempotency_key` | `count`, `pairs`, `coverage`, `unresolved` | Blank/whitespace/surrounding-padded endpoints → `unknown_interval_bounds` (#289; never trim-launder); missing/blank/padded decimals on conflicting/unknown pairs → `missing_decimal_value` (#289); incomplete → API `contradiction_scan_incomplete` → `api_error`. `<2` claims → `invalid_argument`. Empty pairs + complete coverage = certified all-clear. | 1 | intervals + values |
| `formal_eligibility` | `POST /api/v2/context/formal/eligibility` | basis_reviewed, recognition | eligible | auth | 1 | — |
| `assess_support` | `POST /api/v2/context/assess-support` | `claim_revision_id`, `claim_hash`, `evidence_group_revision_id`, optional `alternative_fragment_id` / `tier` / `proposed` / `binding` / `idempotency_key` | `assessmentId`, `judgment`, `explanation` | Missing ids → `invalid_argument`. Blank/whitespace/padded `claim_revision_id` → `incomplete_claim_revision_identity`; blank/padded `evidence_group_revision_id` → `incomplete_evidence_group_identity`; blank/padded `alternative_fragment_id` → `incomplete_alternative_fragment_identity` (evidenceId; never trim-launder). Exact binding alone never invents support. | 1 | Claim + evidence group revisions |
| `eval_catalog` | `GET /api/v2/context/eval/catalog` | (none) | Suite list; `private_gold_denied: true` for non-evaluators | Malformed catalog → `invalid_api_output`; never exposes private gold | 1 | Suite IDs / surface IDs only |

---

## Error semantics (all tools)

| Case | MCP response |
|---|---|
| Unknown tool name | JSON-RPC protocol error (`MethodNotFound`) |
| Malformed `tools/call` envelope (missing name) | JSON-RPC protocol error (`InvalidParams`) |
| Invalid tool arguments | `isError: true` + typed `invalid_argument` in `structuredContent` |
| Invalid / incomplete API payload | `isError: true` + typed `invalid_api_output` |
| HTTP/API business failure | `isError: true` + typed `api_error` / `not_found` / `unauthorized` / `integrity_error` |
| Successful no-match (`query_context` refuse) | Success (`isError` absent/false); status and empty refs in structured content |

Text content is always rendered from the validated structured object for context tools — never by regenerating evidence through a model.
