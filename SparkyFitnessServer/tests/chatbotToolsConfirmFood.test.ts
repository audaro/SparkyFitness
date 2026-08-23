import { describe, expect, it } from 'vitest';
import { CONFIRM_FOOD_TOOL_NAME } from '@workspace/shared';
import { buildConfirmFoodTools } from '../ai/tools/confirmFoodTools.js';

const opts = { toolCallId: 'tc-1', messages: [] };

const internalCandidate = {
  label: 'Chicken Breast, grilled',
  serving_size: 100,
  serving_unit: 'g',
  calories: 165,
  protein: 31,
  source: 'internal',
  food_id: 'fb932a4f-9862-4a4d-8c2d-fcf7f4688acb',
};

const externalCandidate = {
  label: 'Savory Thins Crackers',
  brand: "Trader Joe's",
  serving_size: 30,
  serving_unit: 'g',
  calories: 130,
  protein: 2,
  carbs: 24,
  fat: 3,
  source: 'openfoodfacts',
  external_id: '00511',
  provider_type: 'openfoodfacts',
};

const validInput = {
  question: 'Which chicken is it?',
  quantity: 200,
  unit: 'g',
  meal_type: 'dinner',
  candidates: [internalCandidate, externalCandidate],
};

const run = (input: unknown) =>
  buildConfirmFoodTools()[CONFIRM_FOOD_TOOL_NAME].execute!(
    input as typeof validInput,
    opts
  );

describe('sparky_confirm_food', () => {
  it('is published under the expected tool name', () => {
    expect(Object.keys(buildConfirmFoodTools())).toEqual([
      CONFIRM_FOOD_TOOL_NAME,
    ]);
  });

  it('accepts a valid call and tells the model to stop and wait', async () => {
    // The cards are rendered from the recorded tool call, not this string; the
    // return value exists only so the tool call has a matching tool result.
    await expect(run(validInput)).resolves.toBe(
      'Presented 2 food candidate cards to the user. Stop and wait for their choice — do not log anything until they confirm.'
    );
  });

  // Confirming a single uncertain match (the only external hit, or an AI
  // estimate) is the common case, so one card must be valid — unlike the
  // quick-reply chips, where a single option would be a dead end.
  it('accepts a single candidate and singularizes the echo', async () => {
    await expect(
      run({ ...validInput, candidates: [externalCandidate] })
    ).resolves.toBe(
      'Presented 1 food candidate card to the user. Stop and wait for their choice — do not log anything until they confirm.'
    );
  });

  it('rejects an empty candidate list', async () => {
    await expect(run({ ...validInput, candidates: [] })).resolves.toMatch(
      /candidates/i
    );
  });

  it('rejects more than four candidates', async () => {
    await expect(
      run({
        ...validInput,
        candidates: [
          internalCandidate,
          externalCandidate,
          internalCandidate,
          externalCandidate,
          internalCandidate,
        ],
      })
    ).resolves.toMatch(/candidates/i);
  });

  it('rejects a missing question', async () => {
    await expect(run({ ...validInput, question: '' })).resolves.toMatch(
      /question/i
    );
  });

  it('rejects a candidate without a label', async () => {
    await expect(
      run({
        ...validInput,
        candidates: [{ ...internalCandidate, label: '' }],
      })
    ).resolves.toMatch(/label/i);
  });

  it('rejects a candidate with a non-positive serving size', async () => {
    await expect(
      run({
        ...validInput,
        candidates: [{ ...internalCandidate, serving_size: 0 }],
      })
    ).resolves.toMatch(/serving_size/i);
  });

  it('rejects a candidate with an unknown extra field', async () => {
    // .strict() on the candidate schema keeps the persisted part (and the
    // replay text built from it) free of invented fields.
    await expect(
      run({
        ...validInput,
        candidates: [{ ...internalCandidate, sodium: 12 }],
      })
    ).resolves.toMatch(/sodium/i);
  });

  it('coerces numeric strings the way the other food tools do', async () => {
    await expect(
      run({
        ...validInput,
        candidates: [{ ...internalCandidate, calories: '165' }],
      })
    ).resolves.toContain('Presented 1 food candidate card');
  });

  // Source-dependent id requirements: a card the user can confirm is useless
  // if the follow-up log call has no id to log with.
  it('rejects an internal candidate without a food_id', async () => {
    const { food_id: _dropped, ...noId } = internalCandidate;
    await expect(run({ ...validInput, candidates: [noId] })).resolves.toContain(
      'food_id'
    );
  });

  it('rejects an external candidate without its external_id/provider_type', async () => {
    const { external_id: _e, provider_type: _p, ...noIds } = externalCandidate;
    await expect(
      run({ ...validInput, candidates: [noIds] })
    ).resolves.toContain('external_id');
  });

  // create_food refuses all-zero nutrition and the card shows the user
  // specific numbers, so an estimate must carry its macros explicitly.
  it('rejects an ai_estimate candidate missing its macros', async () => {
    await expect(
      run({
        ...validInput,
        candidates: [
          {
            label: 'Homemade smoothie',
            serving_size: 1,
            serving_unit: 'glass',
            calories: 180,
            source: 'ai_estimate',
          },
        ],
      })
    ).resolves.toMatch(/protein/i);
  });

  it('accepts an ai_estimate candidate with explicit zero macros', async () => {
    await expect(
      run({
        ...validInput,
        candidates: [
          {
            label: 'Black coffee',
            serving_size: 1,
            serving_unit: 'cup',
            calories: 2,
            protein: 0,
            carbs: 0,
            fat: 0,
            source: 'ai_estimate',
          },
        ],
      })
    ).resolves.toContain('Presented 1 food candidate card');
  });

  // Handlers never throw — a bad call comes back as a corrective string the
  // model can retry against (the ai/tools contract).
  it('returns a corrective string rather than throwing on junk input', async () => {
    await expect(run({})).resolves.toEqual(expect.any(String));
  });
});
