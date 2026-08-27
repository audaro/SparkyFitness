import type { Equipment, Muscle } from "./exerciseTaxonomy.ts";
import type { EquipmentItemSlug } from "./equipmentItems.ts";

/**
 * Classification vocabulary for the second external exercise source: the
 * ExerciseDB v1 mirror catalog (1,324 rows, hasaneyldrm/exercises-dataset).
 *
 * Everything here is a mapping of that catalog's own tags onto this repo's
 * canonical vocabularies — coarse `EQUIPMENT`, canonical `MUSCLES`, and the
 * granular equipment items. The maps live in shared because the item gating
 * (`requiredItemsFor`) is shared; the importer that consumes the muscle and
 * equipment maps is server-side. The catalog DATA (names, instructions,
 * media) is never committed — only these classification facts are.
 *
 * All maps are total over the catalog snapshot pinned in
 * `SparkyFitnessServer/tests/fixtures/exercisedbCatalog.ts`; the tests fail
 * if the catalog uses a tag these maps do not decide.
 */
export const EXERCISEDB_SOURCE = "exercisedb";

/**
 * Catalog equipment tag → coarse bucket. `null` marks a tag whose rows the
 * importer must skip outright (nothing in the engine can gate them honestly).
 *
 * The judgement calls: `weighted` (bodyweight plus a plate/vest) and the
 * strongman-ish singles (`rope`, `hammer`, `tire`) land in `other`, matching
 * where free-exercise-db keeps the same movements — `other` is opt-in, so
 * none of them leak into a "no profile" session. `assisted` is
 * partner-assisted stretching, not the assisted-dip tower (those rows are
 * tagged `leverage machine`), so it is body only. Cardio machine tags map to
 * `machine` for completeness, but every such row targets the cardiovascular
 * system, which the muscle map skips.
 */
export const EXERCISEDB_EQUIPMENT_TO_COARSE: Readonly<
  Record<string, Equipment | null>
> = {
  "body weight": "body only",
  dumbbell: "dumbbell",
  cable: "cable",
  barbell: "barbell",
  "leverage machine": "machine",
  band: "bands",
  "smith machine": "machine",
  kettlebell: "kettlebells",
  weighted: "other",
  "stability ball": "exercise ball",
  "ez barbell": "e-z curl bar",
  assisted: "body only",
  "sled machine": "machine",
  "medicine ball": "medicine ball",
  rope: "other",
  roller: "foam roll",
  "resistance band": "bands",
  "bosu ball": "other",
  "olympic barbell": "barbell",
  "wheel roller": "other",
  "upper body ergometer": "machine",
  "skierg machine": "machine",
  hammer: "other",
  "stationary bike": "machine",
  tire: "other",
  "trap bar": "barbell",
  "elliptical machine": "machine",
  "stepmill machine": "machine",
};

/**
 * Catalog target muscle → canonical primary muscle. `null` skips the row
 * (`cardiovascular system` — the planner programs strength, not cardio).
 */
export const EXERCISEDB_TARGET_TO_MUSCLE: Readonly<
  Record<string, Muscle | null>
> = {
  abs: "abdominals",
  abductors: "abductors",
  adductors: "adductors",
  biceps: "biceps",
  calves: "calves",
  "cardiovascular system": null,
  delts: "shoulders",
  forearms: "forearms",
  glutes: "glutes",
  hamstrings: "hamstrings",
  lats: "lats",
  "levator scapulae": "neck",
  pectorals: "chest",
  quads: "quadriceps",
  "serratus anterior": "chest",
  spine: "lower back",
  traps: "traps",
  triceps: "triceps",
  "upper back": "middle back",
};

/**
 * Catalog secondary-muscle value → canonical muscle. `null` drops just that
 * value (ankle stabilizers and friends have no canonical home); the row
 * keeps its other secondaries. Secondary data is loose in this catalog —
 * best-effort is fine here because secondaries only feed set-target
 * accounting, never gating.
 */
export const EXERCISEDB_SECONDARY_TO_MUSCLE: Readonly<
  Record<string, Muscle | null>
> = {
  abdominals: "abdominals",
  "ankle stabilizers": null,
  ankles: null,
  back: "middle back",
  biceps: "biceps",
  brachialis: "biceps",
  calves: "calves",
  chest: "chest",
  core: "abdominals",
  deltoids: "shoulders",
  feet: null,
  forearms: "forearms",
  glutes: "glutes",
  "grip muscles": "forearms",
  groin: "adductors",
  hamstrings: "hamstrings",
  hands: "forearms",
  "hip flexors": null,
  "inner thighs": "adductors",
  "latissimus dorsi": "lats",
  lats: "lats",
  "lower abs": "abdominals",
  "lower back": "lower back",
  obliques: "abdominals",
  quadriceps: "quadriceps",
  "rear deltoids": "shoulders",
  rhomboids: "middle back",
  "rotator cuff": "shoulders",
  shins: null,
  shoulders: "shoulders",
  soleus: "calves",
  sternocleidomastoid: "neck",
  traps: "traps",
  trapezius: "traps",
  triceps: "triceps",
  "upper back": "middle back",
  "upper chest": "chest",
  "wrist extensors": "forearms",
  "wrist flexors": "forearms",
  wrists: "forearms",
};

/**
 * Per-row item requirements for this catalog, same contract as
 * free-exercise-db's ITEM_REQUIREMENTS_BY_SOURCE_ID: the stated items that
 * satisfy the row (any-of). Generated from the catalog's names on
 * 2026-08-27 and hand-reviewed; rows absent here fall back to the generic
 * coarse-bucket defaults (`lever gripper hands` and `lever deadlift` are
 * deliberately generic — no station of ours maps to them honestly).
 */
export const EXERCISEDB_ITEM_REQUIREMENTS_BY_SOURCE_ID: Readonly<
  Record<string, readonly EquipmentItemSlug[]>
> = {
  // assisted chest dip (kneeling)
  '0009': ['assisted-pullup-dip'],
  // assisted parallel close grip pull-up
  '0015': ['assisted-pullup-dip'],
  // assisted pull-up
  '0017': ['assisted-pullup-dip'],
  // assisted triceps dip (kneeling)
  '0019': ['assisted-pullup-dip'],
  // battling ropes
  '0128': ['battle-ropes'],
  // lever alternating narrow grip seated row
  '0571': ['row-machine'],
  // lever assisted chin-up
  '0572': ['assisted-pullup-dip'],
  // lever back extension
  '0573': ['back-extension-machine'],
  // lever bicep curl
  '0575': ['arm-curl-machine'],
  // lever chest press
  '0576': ['chest-press-machine'],
  // lever chest press
  '0577': ['chest-press-machine'],
  // lever front pulldown
  '0579': ['lat-pulldown'],
  // lever gripless shrug
  '0580': ['shrug-machine'],
  // lever high row
  '0581': ['row-machine'],
  // lever kneeling leg curl
  '0582': ['leg-curl-machine'],
  // lever kneeling twist
  '0583': ['torso-rotation-machine'],
  // lever lateral raise
  '0584': ['lateral-raise-machine'],
  // lever leg extension
  '0585': ['leg-extension-machine'],
  // lever lying leg curl
  '0586': ['leg-curl-machine'],
  // lever military press
  '0587': ['shoulder-press-machine'],
  // lever narrow grip seated row
  '0588': ['row-machine'],
  // lever one arm shoulder press
  '0590': ['shoulder-press-machine'],
  // lever overhand triceps dip
  '0591': ['triceps-machine'],
  // lever preacher curl
  '0592': ['arm-curl-machine'],
  // lever reverse hyperextension
  '0593': ['reverse-hyper'],
  // lever seated calf raise
  '0594': ['calf-machine'],
  // lever seated crunch (chest pad)
  '0595': ['ab-crunch-machine'],
  // lever seated fly
  '0596': ['pec-deck'],
  // lever seated hip abduction
  '0597': ['hip-abductor-adductor'],
  // lever seated hip adduction
  '0598': ['hip-abductor-adductor'],
  // lever seated leg curl
  '0599': ['leg-curl-machine'],
  // lever seated leg raise crunch
  '0600': ['ab-crunch-machine'],
  // lever seated reverse fly (parallel grip)
  '0601': ['pec-deck'],
  // lever seated reverse fly
  '0602': ['pec-deck'],
  // lever shoulder press
  '0603': ['shoulder-press-machine'],
  // lever shrug
  '0604': ['shrug-machine'],
  // lever standing calf raise
  '0605': ['calf-machine'],
  // lever t bar row
  '0606': ['row-machine'],
  // lever triceps extension
  '0607': ['triceps-machine'],
  // london bridge
  '0609': ['climbing-rope'],
  // reverse grip machine lat pulldown
  '0673': ['lat-pulldown'],
  // rope climb
  '0680': ['climbing-rope'],
  // sled 45в° calf press
  '0738': ['leg-press'],
  // sled 45в° leg press
  '0739': ['leg-press'],
  // sled 45в° leg wide press
  '0740': ['leg-press'],
  // sled closer hack squat
  '0741': ['hack-squat'],
  // sled forward angled calf raise
  '0742': ['leg-press'],
  // sled hack squat
  '0743': ['hack-squat'],
  // sled lying squat
  '0744': ['leg-press'],
  // smith back shrug
  '0746': ['smith-machine'],
  // smith behind neck press
  '0747': ['smith-machine'],
  // smith bench press
  '0748': ['smith-machine'],
  // smith bent knee good morning
  '0749': ['smith-machine'],
  // smith chair squat
  '0750': ['smith-machine'],
  // smith close-grip bench press
  '0751': ['smith-machine'],
  // smith deadlift
  '0752': ['smith-machine'],
  // smith decline bench press
  '0753': ['smith-machine'],
  // smith decline reverse-grip press
  '0754': ['smith-machine'],
  // smith hack squat
  '0755': ['smith-machine'],
  // smith hip raise
  '0756': ['smith-machine'],
  // smith incline bench press
  '0757': ['smith-machine'],
  // smith incline reverse-grip press
  '0758': ['smith-machine'],
  // smith incline shoulder raises
  '0759': ['smith-machine'],
  // smith leg press
  '0760': ['smith-machine'],
  // smith narrow row
  '0761': ['smith-machine'],
  // smith rear delt row
  '0762': ['smith-machine'],
  // smith reverse calf raises
  '0763': ['smith-machine'],
  // smith reverse-grip press
  '0764': ['smith-machine'],
  // smith seated shoulder press
  '0765': ['smith-machine'],
  // smith shoulder press
  '0766': ['smith-machine'],
  // smith shrug
  '0767': ['smith-machine'],
  // smith single leg split squat
  '0768': ['smith-machine'],
  // smith sprint lunge
  '0769': ['smith-machine'],
  // smith squat
  '0770': ['smith-machine'],
  // smith standing back wrist curl
  '0771': ['smith-machine'],
  // smith standing behind head military press
  '0772': ['smith-machine'],
  // smith standing leg calf raise
  '0773': ['smith-machine'],
  // smith standing military press
  '0774': ['smith-machine'],
  // smith upright row
  '0775': ['smith-machine'],
  // lever shoulder press v. 2
  '0869': ['shoulder-press-machine'],
  // lever donkey calf raise
  '1253': ['calf-machine'],
  // lever incline chest press
  '1299': ['chest-press-machine'],
  // lever decline chest press
  '1300': ['chest-press-machine'],
  // machine inner chest press
  '1301': ['chest-press-machine'],
  // smith wide grip bench press
  '1308': ['smith-machine'],
  // smith wide grip decline bench press
  '1309': ['smith-machine'],
  // lever unilateral row
  '1313': ['row-machine'],
  // lever one arm lateral wide pulldown
  '1347': ['lat-pulldown'],
  // lever reverse grip vertical row
  '1348': ['row-machine'],
  // lever reverse t-bar row
  '1349': ['row-machine'],
  // lever seated row
  '1350': ['row-machine'],
  // lever t-bar reverse grip row
  '1351': ['row-machine'],
  // lever one arm lateral high row
  '1356': ['row-machine'],
  // smith bent over row
  '1359': ['smith-machine'],
  // smith one arm row
  '1360': ['smith-machine'],
  // smith reverse grip bent over row
  '1361': ['smith-machine'],
  // hack calf raise
  '1383': ['hack-squat'],
  // hack one leg calf raise
  '1384': ['hack-squat'],
  // lever seated squat calf raise on leg press machine
  '1385': ['leg-press'],
  // sled calf press on leg press
  '1391': ['leg-press'],
  // sled one leg calf press on leg press
  '1392': ['leg-press'],
  // smith one leg floor calf raise
  '1393': ['smith-machine'],
  // smith reverse calf raises
  '1394': ['smith-machine'],
  // smith seated one leg calf raise
  '1395': ['smith-machine'],
  // smith toe raise
  '1396': ['smith-machine'],
  // sled 45 degrees one leg press
  '1425': ['leg-press'],
  // smith seated wrist curl
  '1426': ['smith-machine'],
  // assisted standing chin-up
  '1431': ['assisted-pullup-dip'],
  // assisted standing pull-up
  '1432': ['assisted-pullup-dip'],
  // smith front squat (clean grip)
  '1433': ['smith-machine'],
  // smith low bar squat
  '1434': ['smith-machine'],
  // lever gripless shrug v. 2
  '1439': ['shrug-machine'],
  // lever seated dip
  '1451': ['triceps-machine'],
  // lever seated crunch
  '1452': ['ab-crunch-machine'],
  // sled 45° leg press (side pov)
  '1463': ['leg-press'],
  // sled 45в° leg press (back pov)
  '1464': ['leg-press'],
  // lever incline chest press v. 2
  '1479': ['chest-press-machine'],
  // lever preacher curl v. 2
  '1614': ['arm-curl-machine'],
  // lever hammer grip preacher curl
  '1615': ['arm-curl-machine'],
  // lever reverse grip preacher curl
  '1616': ['arm-curl-machine'],
  // smith machine decline close grip bench press
  '1625': ['smith-machine'],
  // smith machine reverse decline close grip bench press
  '1626': ['smith-machine'],
  // smith machine bicep curl
  '1683': ['smith-machine'],
  // smith machine incline tricep extension
  '1752': ['smith-machine'],
  // lever pullover
  '2285': ['lat-pulldown'],
  // lever hip extension v. 2
  '2286': ['glute-machine'],
  // lever alternate leg press
  '2287': ['leg-press'],
  // lever calf press
  '2289': ['leg-press'],
  // lever rotary calf
  '2315': ['calf-machine'],
  // lever shoulder press v. 3
  '2318': ['shoulder-press-machine'],
  // sled lying calf press
  '2334': ['leg-press'],
  // lever seated calf press
  '2335': ['leg-press'],
  // assisted wide-grip chest dip (kneeling)
  '2364': ['assisted-pullup-dip'],
  // lever horizontal one leg press
  '2611': ['leg-press'],
  // jump rope
  '2612': ['jump-rope'],
  // lever reverse grip lateral pulldown
  '2736': ['lat-pulldown'],
  // smith sumo squat
  '3142': ['smith-machine'],
  // lever lying two-one leg curl
  '3195': ['leg-curl-machine'],
  // lever bent-over row with v-bar
  '3200': ['row-machine'],
  // smith full squat
  '3281': ['smith-machine'],
  // lever standing chest press
  '3758': ['chest-press-machine'],
  // lever seated good morning
  '3759': ['back-extension-machine'],
  // lever seated crunch v. 2
  '3760': ['ab-crunch-machine'],
};

/** Map form of the requirements — object key lookup is prototype-unsafe. */
export const EXERCISEDB_ITEM_REQUIREMENTS_LOOKUP: ReadonlyMap<
  string,
  readonly EquipmentItemSlug[]
> = new Map(Object.entries(EXERCISEDB_ITEM_REQUIREMENTS_BY_SOURCE_ID));
