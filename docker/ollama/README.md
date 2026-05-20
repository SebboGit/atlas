# Ollama — `atlas-extract` model

Atlas's document extraction (boarding passes, hotel confirmations, etc.)
runs against a local Ollama instance — see
[`docs/adr/0006-ollama-only-llm-extraction.md`](../../docs/adr/0006-ollama-only-llm-extraction.md).

We do not fine-tune weights. Instead we derive a tagged model variant —
`atlas-extract` — from `qwen2.5:7b` with parameters and a short SYSTEM
prompt baked in. This is an **Ollama Modelfile**, not training.

## Why a derived model

Three reasons it matters in practice:

1. **Context window.** Ollama's default `num_ctx` is small enough (often
   2048 tokens) that our 8000-character document inputs are silently
   truncated by the runtime. The Modelfile sets `num_ctx 8192`.
2. **Determinism.** Extraction is not creative. `temperature 0`,
   `top_p 0.1`, `top_k 1` mean the same document produces the same JSON
   across calls — critical for diffing extractions and for test stability.
3. **System prompt reinforcement.** The "JSON only, no markdown, null for
   missing, never invent" contract is hoisted into SYSTEM so it isn't
   relitigated in every user prompt.

The application code remains the authoritative source of the per-hint
JSON schema — those live in [`src/lib/extraction/prompts.ts`](../../src/lib/extraction/prompts.ts)
because they vary by document kind. The Modelfile reinforces, never
replaces, the user prompt.

## One-time build

The Modelfile in this directory is the canonical specification. There
are two ways to register it with your Ollama instance — pick whichever
matches where the Ollama daemon lives and what access you have.

`qwen2.5:7b` must already be pulled on the Ollama host before either
path works (`ollama pull qwen2.5:7b`).

### Path A — CLI (`ollama create -f`)

Use this when you have a shell on the host (or container) where the
Ollama daemon runs and the Modelfile is reachable from that shell. The
CLI does the translation to Ollama's internal format for you, so this
path is version-agnostic.

```bash
# If Ollama runs natively on a host you can SSH to:
scp docker/ollama/atlas-extract.Modelfile <user>@<ollama-host>:/tmp/
ssh <user>@<ollama-host> 'ollama create atlas-extract -f /tmp/atlas-extract.Modelfile'

# If Ollama runs in a container on that host:
scp docker/ollama/atlas-extract.Modelfile <user>@<ollama-host>:/tmp/
ssh <user>@<ollama-host> '
  docker cp /tmp/atlas-extract.Modelfile <container>:/tmp/
  docker exec <container> ollama create atlas-extract -f /tmp/atlas-extract.Modelfile
'
```

### Path B — HTTP API (structured payload)

Use this when the Ollama daemon is reachable over the network (typical
for a homelab over Tailscale or a reverse-proxied hostname) but you
can't easily get the Modelfile onto the host. This works from anywhere
the API is reachable, including the dev machine running Atlas.

Ollama's `/api/create` endpoint changed shape:

- **Older versions** accepted `{"name": "...", "modelfile": "<raw text>"}`.
  That form is **deprecated and rejected** on current Ollama
  (≥ ~0.5 / 0.24.x and later) with `{"error":"neither 'from' or 'files' was specified"}`.
- **Current versions** want a structured payload: `from` (base model)
  plus separate `system` and `parameters` fields.

The script below extracts the SYSTEM prompt out of the Modelfile,
hardcodes the same parameter values, and POSTs the structured shape.
Run from the repo root with `$OLLAMA_URL` pointing at your daemon:

```bash
SYSTEM_PROMPT=$(awk '/^SYSTEM """/{flag=1; sub(/^SYSTEM """/,""); print; next}
                     /"""$/{sub(/"""$/,""); print; flag=0; exit}
                     flag' docker/ollama/atlas-extract.Modelfile)

jq -n --arg sys "$SYSTEM_PROMPT" '{
  model: "atlas-extract",
  from: "qwen2.5:7b",
  system: $sys,
  parameters: {
    temperature: 0,
    top_p: 0.1,
    top_k: 1,
    repeat_penalty: 1.0,
    num_ctx: 8192,
    num_predict: 1024
  }
}' | curl -sS -N -X POST "$OLLAMA_URL/api/create" \
       -H 'content-type: application/json' \
       --data-binary @-
```

You should see a stream of `{"status":"..."}` lines terminating with
`{"status":"success"}`.

**Important caveat for Path B:** the parameter values are duplicated
between the Modelfile and the script. The Modelfile remains the spec;
if you change a `PARAMETER` line there, update the corresponding key in
the `jq` body too. Path A doesn't have this problem — the CLI parses
the Modelfile directly.

### Verify (same for both paths)

```bash
# Via the API — works regardless of where Ollama runs:
curl -sS "$OLLAMA_URL/api/tags" | jq '.models[] | select(.name | startswith("atlas-extract"))'
curl -sS "$OLLAMA_URL/api/show" -d '{"name":"atlas-extract"}' | jq '{parameters, system}'

# Or on the host:
ollama list | grep atlas-extract
ollama show atlas-extract --modelfile
```

Then point the app at it via `.env`:

```env
OLLAMA_MODEL=atlas-extract:latest
```

Restart the app (`pnpm dev:up` or `docker compose restart app`).

## Rebuilding after a change

Edit `atlas-extract.Modelfile`, then re-run whichever path you used
above with the same model name — Ollama overwrites the existing tag.

No app changes or restarts are needed if only parameters or the SYSTEM
prompt changed — Ollama serves the new variant on the next request.

If you used Path B, remember to mirror the change into the `jq` body
before re-running. If you find yourself doing this often, it's a signal
that you should switch to Path A on that host.

## Falling back to the base model

The extractor is designed to work against bare `qwen2.5:7b` too. The
Modelfile is purely additive. If you want to skip the build step (e.g.
on a fresh host before getting Ollama configured) set:

```env
OLLAMA_MODEL=qwen2.5:7b
```

Expect lower-quality output: input may be truncated by the runtime,
sampling is non-deterministic, and the JSON-only contract has to be
re-asserted in every prompt instead of carried by the model.

## Choosing a different base model

`FROM qwen2.5:7b` is the line to edit. Any Ollama-supported instruction-
tuned model works in principle, but verify two things before swapping:

- **Tool/JSON behaviour.** The `format: 'json'` request mode in
  `src/lib/extraction/ollama.ts` relies on the model + Ollama runtime
  honouring constrained decoding. Most modern Qwen/Llama/Mistral
  instruct variants do.
- **Context handling.** `num_ctx 8192` must be within the chosen base
  model's trained context length. All current candidates handle this
  trivially.

If you switch the base model in production, write an ADR superseding 0006.
