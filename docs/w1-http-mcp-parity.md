# W1 HTTP ↔ MCP parity table

Q1/R9 transport parity for Webcite context and legacy v1 capabilities. Presentation numbers are not evidence identity. Scope is always resolved by authenticated Webcite; MCP annotations cannot supply Scope.

| MCP tool | HTTP route | Request (key fields) | Output | Failure / partial | Cost | Source identity |
|---|---|---|---|---|---|---|
| `verify_claim` | `POST /api/v1/verify` | claim, stance/verdict flags | sources + verdict | API error → `isError` | 2–4 credits | citation URLs / asset ids |
| `verify_claim_stream` | `POST /api/v1/verify/stream` | same | assembled stream result | transport/API error | same | same |
| `search_sources` | `POST /api/v1/sources/search` | query, limit | raw citations | empty ≠ error | 2 | external discovery |
| `list_citations` | `GET /api/v1/citations` | pagination | citation list | auth | 1 | stored citation ids |
| `get_citation` | `GET /api/v1/citations/:id` | id | citation | 404 | 1 | citation id |
| `get_source_preview` | `POST /api/v1/citations/source-preview` | url/asset/versioned ids | preview + binding | unread → no confidence | billed | `source_version_id` / unit |
| `verify_batch` | `POST /api/v1/verify/batch` | items[] | per-item binding/judgment | per-item `error` | billed | versioned or inline |
| `verify_feedback` | `POST /api/v1/verify/feedback` | token, verdict | recorded | invalid token | 0 | token payload |
| `analyze_conflicts` | `POST /api/v1/analyze/conflicts` | figures/claims | conflict report | partial figures | billed | figure provenance |
| `analyze_document` | `POST /api/v1/analyze/document` | asset_id | figures + accuracy | unsupported type | billed | asset / cells |
| `classify_document` | `POST /api/v1/classify` | asset ref | category + covers | 400 missing asset | billed | asset |
| `document_gaps` | `POST /api/v1/gaps` | category + docs | gap checklist | empty checklist | billed | doc ids |
| `extract_document` | `POST /api/v1/extract` | asset ref | markdown + units | 400 | billed | asset; prefers persisted SourceUnits when `CONTEXT_GRAPH_RETRIEVE` |
| `extract_figures` | `POST /api/v1/extract/figures` | asset ref | figures[] | empty list on soft fail | billed | asset provenance |
| `accuracy_report` | `GET /api/v1/accuracy` | — | report | auth | 0–1 | — |
| `upload_file` | `POST /api/v1/upload` | multipart | asset_id | size/type | 0 | new asset |
| `get_answer` | `GET /api/v2/answers/:revisionId` | revisionId | `ResolvedAnswer` + presentation + freshness | integrity/auth | 0 | answer + packet hashes |
| `get_evidence_packet` | `GET /api/v2/evidence-packets/:id` | packetId | `ResolvedPacket` + numbered_refs | A_PACKET_REVISION integrity | 0 | packet id + contentHash |
| `query_context` | `POST /api/v2/context/query` | text, source_texts/ids, filters | refs + plan + presentation | `refuse` ≠ HTTP error | 0 | sourceVersionId / nodeId |
| `compare_assertions` | `POST /api/v2/context/compare-assertions` | left/right ClaimScope | `same\|different\|unknown` | auth | 0 | scopes only |
| `get_change_impact` | `POST /api/v2/context/change-impact` | answer_revision_id | freshness observation | integrity | 0 | answer sources |
| `create_evidence_packet` | `POST /api/v2/context/evidence-packets` | claim_text + bindings | packet_id + hashes | auth / missing binding | 0 | sealed server-built packet |
| `assess_support` | `POST /api/v2/context/assess-support` | claim_revision_id, claim_hash, evidence_group_revision_id, tier? | SupportResult (tier-capped) | auth / missing ids | 0 | claim + claim hashes |
| `eval_catalog` | `GET /api/v2/context/eval/catalog` | — | suite ids + `private_gold_denied` | auth | 0 | E1 catalog only |

## Notes

- Successful no-match query returns `status: 'refuse'` / empty refs with HTTP 200.
- Unknown MCP tool / malformed envelope → protocol error; API/business failures → `isError: true`.
- `private_gold_denied: true` is intentional for A_EVAL_CATALOG transport; gold stays off the wire.
- Engine rollback: turn off `CONTEXT_GRAPH_RETRIEVE`; sealed revisions remain readable via v2 resolve routes.
