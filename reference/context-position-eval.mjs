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
      const hasAnswer = output && output.answer === fixture.expected_answer;
      const hasCitation = Array.isArray(output?.cited_memory_ids) &&
        output.cited_memory_ids.includes(fixture.expected_memory_id);
      const noTools = Array.isArray(output?.tool_calls) && output.tool_calls.length === 0;
      observations.push(Object.freeze({ case_id: fixture.id, position,
        correct: Boolean(hasAnswer && hasCitation && noTools) }));
    }
  }
  const perPosition = Object.fromEntries(positions.map(position => {
    const subset = observations.filter(o => o.position === position);
    return [position, Object.freeze({ correct: subset.filter(o => o.correct).length, total: subset.length })];
  }));
  return Object.freeze({ total_observations: observations.length,
    observations: Object.freeze(observations), per_position: Object.freeze(perPosition) });
}
