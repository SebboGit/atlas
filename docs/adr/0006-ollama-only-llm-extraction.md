# ADR-0006: Ollama (local-only) for LLM extraction

- **Status:** Accepted
- **Date:** 2026-05-15
- **Deciders:** @SebboGit

## Context

Atlas's extraction pipeline turns raw OCR/text from uploaded documents (boarding passes, hotel confirmations, tickets) into structured JSON: airline, flight number, route, times, confirmation codes, prices, etc. The final stage of that pipeline is an LLM call.

The earlier scaffolding (CLAUDE.md, `.env.example`, ADR drafts) left this open as a strategy switch: `cloud` (Claude API / Haiku) vs `local` (Ollama) vs `auto`. That ambiguity has costs:

- Two code paths to maintain, test, and reason about.
- A subtle privacy footgun: a misconfigured `EXTRACTION_STRATEGY=auto` could quietly ship document text to a third party.
- Anthropic API keys and quotas to provision and rotate even when local inference is the actual intent.

Atlas is a personal, self-hosted travel companion that handles passport scans, boarding passes, and home addresses. The deployment target is a homelab with the GPU/CPU budget to run a small open-weights model locally.

## Decision

LLM extraction runs against a self-hosted **Ollama** instance. **No cloud LLM calls are part of the extraction pipeline.**

- Default model: `qwen2.5:7b` (configurable via `OLLAMA_MODEL`).
- Endpoint: `OLLAMA_URL` (default `http://localhost:11434`).
- Implementation: `src/lib/extraction/ollama.ts`, behind an `LLMExtractor` interface so a different backend remains a config swap (not a rewrite).
- The `EXTRACTION_STRATEGY` env var is removed. There is only one strategy.
- `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` are removed from `.env.example`.

## Consequences

### Positive

- **Privacy by default.** Document content cannot leak to a third party because the code can't make that call.
- **Zero per-document cost.** Inference happens on hardware that's already paid for.
- **No quota anxiety.** No rate limits, no monthly cap, no key rotation.
- **Simpler mental model.** One pipeline, one set of failure modes.

### Negative / tradeoffs

- **Latency.** Local 7B inference is slower than Haiku on the network, especially on CPU. Mitigated by running extraction asynchronously and showing the user a "Processing…" state.
- **Quality ceiling.** A small open-weights model will not match Haiku on every layout. The pipeline already supports user review and `Document.overrides` — corrections improve the record without re-running.
- **Hardware floor.** The deployment host must run Ollama. For a homelab user this is a one-time decision, not an ongoing constraint.

### Neutral

- The `LLMExtractor` interface still exists. Adding a cloud option in the future is a new file plus a config flag — but it requires a superseding ADR.

## Alternatives considered

- **Cloud-only (Claude Haiku).** Lower latency, higher quality, but: per-call cost, vendor dependency, key management, and — most importantly — outbound document content. Rejected on privacy and self-hosting principles.
- **Hybrid with `EXTRACTION_STRATEGY=auto`.** Sounds flexible, ships two code paths and an easy-to-misconfigure default. Rejected: optionality has a real maintenance cost, and the cloud path was never going to be the chosen one in practice.
- **Other local runtimes (llama.cpp directly, LM Studio, vLLM).** All viable. Ollama wins on operational ergonomics: simple HTTP API, easy model management, well-supported.

## References

- ADR-0001 — Local filesystem storage (similar self-hosted-first reasoning).
- [Ollama](https://ollama.com)
- [Qwen2.5](https://qwenlm.github.io/blog/qwen2.5/)
