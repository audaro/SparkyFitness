/**
 * The two things the food-photo scenario cannot get from the app: a photograph
 * on the simulator, and an AI vision provider's answer to it.
 *
 * Both live here rather than in the flow or the oracle because both are read
 * from two ends. The estimate is served by qa/bin/qa-ai-stub.mjs and asserted
 * by qa/oracles/food-photo.mjs; the photo is written by qa/setup/food-photo.sh
 * and its dimensions are asserted out of what the app actually uploaded. A
 * second copy of either would drift the first time a number changed.
 */
import { deflateSync } from 'node:zlib';

// The provider's answer, verbatim. Every number here is asserted back out of
// the database after it has crossed the stub, the server, the estimate review
// form and the log-entry screen, so they are chosen to be mutually
// unmistakable: no two share a value, none is a round number another could be
// confused with, and none matches the serving size the flow types.
export const ESTIMATE = {
  meal_summary: 'QA Stub Chicken Rice Bowl',
  overall_confidence: 'medium',
  confidence_reason: 'Portion depth is hard to judge from a single angle.',
  items: [
    {
      name: 'grilled chicken thigh',
      estimated_grams: 185,
      portion_description: '2 medium thighs',
      preparation: 'grilled',
      calories_kcal: 388,
      protein_g: 39.5,
      carbs_g: 0,
      fat_g: 24.5,
      fiber_g: 0,
      sugar_g: 0,
      item_confidence: 'high',
      assumptions: ['assumed skinless', 'assumed cooked in 1 tsp oil'],
    },
    {
      name: 'white jasmine rice',
      estimated_grams: 280,
      portion_description: '1 1/2 cups cooked',
      preparation: 'steamed',
      calories_kcal: 364,
      protein_g: 6.75,
      carbs_g: 79.25,
      fat_g: 0.75,
      fiber_g: 1.25,
      sugar_g: 0.25,
      item_confidence: 'medium',
      assumptions: [],
    },
  ],
  // Deliberately NOT the sum of the items: the review form is fed from
  // `totals`, so a screen that quietly re-derived them from the item rows
  // would show plausible numbers and fail here.
  totals: {
    calories_kcal: 636,
    protein_g: 47.5,
    carbs_g: 58.25,
    fat_g: 19.75,
    fiber_g: 6.5,
    sugar_g: 4.25,
    total_grams: 465,
  },
  user_weight_reconciliation:
    'Distributed the stated total weight across both items by visual proportion.',
  clarifying_questions: ['Was the rice cooked with butter?'],
};

// The seeded photograph. A flat pattern rather than a real meal photo: the
// provider is a stub, so nothing ever looks at the pixels — what matters is
// that it is a real image file the picker will offer, the app will read, and
// the stub can measure. Its size is the evidence that THIS file is what
// reached the provider, so it is deliberately not a common default.
export const PHOTO_WIDTH = 646;
export const PHOTO_HEIGHT = 482;

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * A PNG, hand-encoded, because the alternative is committing a binary blob to
 * a public repo or shelling out to an image tool that may not be installed.
 * PNG rather than JPEG for the same reason: it is the one raster format whose
 * encoder is a dozen lines of zlib, and the server's allow-list takes it.
 */
export function mealPhotoPng() {
  const stride = PHOTO_WIDTH * 3 + 1;
  const raw = Buffer.alloc(stride * PHOTO_HEIGHT);
  for (let y = 0; y < PHOTO_HEIGHT; y += 1) {
    const row = y * stride;
    raw[row] = 0; // filter: none
    for (let x = 0; x < PHOTO_WIDTH; x += 1) {
      const px = row + 1 + x * 3;
      raw[px] = (x * 255) / PHOTO_WIDTH;
      raw[px + 1] = (y * 255) / PHOTO_HEIGHT;
      raw[px + 2] = (((x >> 6) ^ (y >> 6)) * 51) & 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(PHOTO_WIDTH, 0);
  ihdr.writeUInt32BE(PHOTO_HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
