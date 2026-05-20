import { describe, expect, it } from 'vitest';

import { buildPrompt, MAX_INPUT_CHARS, STRICT_RETRY_SUFFIX } from './prompts';

describe('buildPrompt', () => {
  it('embeds the input text verbatim when it fits within the budget', () => {
    const text = 'A normal-length extracted boarding pass text body.';
    const out = buildPrompt(text);

    expect(out).toContain(text);
    expect(out).toContain('IATA');
    // Sanity: under budget, output is bounded by prompt overhead + input.
    // Discriminated-union schema adds more overhead than a single-kind
    // prompt did, hence the larger budget.
    expect(out.length).toBeLessThan(text.length + 4_000);
  });

  it('truncates input longer than MAX_INPUT_CHARS', () => {
    // Generate a body the prompt builder must trim. We can't easily
    // pin "the prompt has exactly N chars of body" because the prompt
    // wraps the body with scaffolding, so we assert the substring
    // boundary the truncation guarantees: the (MAX_INPUT_CHARS + 1)th
    // character of the input cannot appear in the output.
    const a = 'A'.repeat(MAX_INPUT_CHARS);
    const b = 'B'.repeat(50); // sentinel — must NOT appear in the prompt
    const oversize = a + b;

    const out = buildPrompt(oversize);

    expect(out).toContain('A'.repeat(100));
    expect(out).not.toContain(b);
  });

  it('emits all three schemas in a single discriminated-union prompt', () => {
    // The new prompt lets the LLM pick the kind from content, so a
    // single buildPrompt call must include every variant the model is
    // allowed to return.
    const out = buildPrompt('irrelevant body');

    expect(out).toContain('"kind": "boarding-pass"');
    expect(out).toContain('"kind": "hotel-confirmation"');
    expect(out).toContain('"kind": "generic"');
  });

  it('instructs the model to prefer generic when uncertain', () => {
    // Anti-hallucination guard: under-classify rather than mis-classify.
    // If this disappears, regressions are likely on ambiguous docs
    // (passport scans, train tickets, voucher PDFs).
    const out = buildPrompt('irrelevant body');
    expect(out).toMatch(/uncertain.*generic/i);
  });

  it('exports a stable STRICT_RETRY_SUFFIX that can be appended downstream', () => {
    // Pin only the load-bearing semantics — "respond with valid JSON
    // only" — not the exact wording. The test in ollama.test.ts already
    // asserts the suffix is appended on retry.
    expect(STRICT_RETRY_SUFFIX).toMatch(/JSON/i);
    expect(STRICT_RETRY_SUFFIX).toMatch(/valid/i);
  });
});
