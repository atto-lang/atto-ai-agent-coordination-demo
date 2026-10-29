// Offline evaluation harness for context-position sensitivity (Liu et al., 2024).
// Not an LLM, retriever, tokenizer, or privileged tool runner. Callback must be a
// separately configured test model adapter; this code never dispatches tools.
const positions = ['first', 'middle', 'last'];
const idOk = s => typeof s === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(s);

export async function evaluate_context_positions({ cases, runModel }) {
  if (!Array.isArray(cases) || cases.length === 0 || cases.length > 128 ||
      typeof runModel !== 'function') throw new TypeError('bounded cases and model callback required');
  const observations = [];
  for (const fixture of cases) {
    if (!fixture || !idOk(fixture.id) || typeof fixture.question !== 'string' ||
        fixture.question.length < 1 || fixture.question.length > 1024 ||
        typeof fixture.expected_answer !== 'string' ||
        fixture.expected_answer.length > 4096 ||
        !idOk(fixture.expected_memory_id) || !Array.isArray(fixture.excerpts) ||
        fixture.excerpts.length < 3 || fixture.excerpts.length > 24 ||
        fixture.excerpts.some(e => !e || !idOk(e.memory_id) ||
          typeof e.evidence_ref !== 'string' || e.evidence_ref.length > 256 ||
          typeof e.excerpt !== 'string' || e.excerpt.length > 4096) ||
        new Set(fixture.excerpts.map(e => e.memory_id)).size !== fixture.excerpts.length ||
        fixture.excerpts.filter(e => e.memory_id === fixture.expected_memory_id).length !== 1) {
      throw new TypeError('invalid context-position fixture');
    }
    const target = fixture.excerpts.find(e => e.memory_id === fixture.expected_memory_id);
    const distractors = fixture.excerpts.filter(e => e.memory_id !== fixture.expected_memory_id);
    for (const position of positions) {
      const selected = distractors.map(e => ({ ...e }));
      const index = position === 'first' ? 0 : position === 'last' ? selected.length : Math.floor(selected.length / 2);
      selected.splice(index, 0, { ...target });
      const context_json = JSON.stringify({ classification: 'untrusted_context_data', records: selected });
      // Fail closed on oversized fixtures without pretending to enforce a real model's tokens.
      if (Buffer.byteLength(context_json, 'utf8') > 65536) throw new TypeError('oversized evaluation context');
      let output;
      try { output = await runModel(Object.freeze({
        case_id: fixture.id, position, question: fixture.question, context_json
      })); } catch { output = null; }
      let correct = false;
      try {
        // Reject exotic response envelopes, accessor properties, forged
        // citations and duplicate citation IDs; never trust model grading.
        if (output && Object.getPrototypeOf(output) === Object.prototype &&
            !Array.isArray(output) &&
            Reflect.ownKeys(output).length === 3 &&
            ['answer', 'cited_memory_ids', 'tool_calls'].every(key =>
              Object.hasOwn(Object.getOwnPropertyDescriptor(output, key) ?? {}, 'value'))) {
          const answer = Object.getOwnPropertyDescriptor(output, 'answer').value;
          const citations = Object.getOwnPropertyDescriptor(output, 'cited_memory_ids').value;
          const toolCalls = Object.getOwnPropertyDescriptor(output, 'tool_calls').value;
          const allowed = new Set(selected.map(e => e.memory_id));
          // Never execute array element getters or let non-index properties
          // hide a tool request in an apparently empty tool_calls array.
          const cleanIds = value => {
            if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
                value.length < 1 || value.length > selected.length ||
                Reflect.ownKeys(value).length !== value.length + 1) return null;
            const ids = [];
            for (let i = 0; i < value.length; i++) {
              const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
              if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
                  typeof descriptor.value !== 'string' ||
                  !allowed.has(descriptor.value)) return null;
              ids.push(descriptor.value);
            }
            return ids;
          };
          const ids = cleanIds(citations);
          const noTools = Array.isArray(toolCalls) &&
            Object.getPrototypeOf(toolCalls) === Array.prototype &&
            toolCalls.length === 0 &&
            Reflect.ownKeys(toolCalls).length === 1 &&
            Reflect.ownKeys(toolCalls)[0] === 'length';
          const grounded = ids !== null &&
            new Set(ids).size === ids.length &&
            ids.includes(fixture.expected_memory_id);
          correct = typeof answer === 'string' &&
            answer === fixture.expected_answer && grounded && noTools;
        }
      } catch { correct = false; }
      observations.push(Object.freeze({ case_id: fixture.id, position,
        correct }));
    }
  }
  const perPosition = Object.fromEntries(positions.map(position => {
    const subset = observations.filter(o => o.position === position);
    return [position, Object.freeze({ correct: subset.filter(o => o.correct).length, total: subset.length })];
  }));
  return Object.freeze({ total_observations: observations.length,
    observations: Object.freeze(observations), per_position: Object.freeze(perPosition) });
}
