// Generated labels for the shared equipment-item vocabulary (see shared/src/constants/equipmentItems.ts).

import type { TFunction } from 'i18next';
import type {
  EquipmentItemCategory,
  EquipmentItemSlug,
  GymTemplateSlug,
} from '@workspace/shared';

/**
 * English labels for the granular equipment vocabulary. Static keys with
 * literal defaults, one case per slug, following the exercise-taxonomy
 * localizer: the i18n audit rejects dynamic keys, and a translator needs
 * every key visible in the source locale file.
 */
export function localizeEquipmentItem(
  t: TFunction,
  slug: EquipmentItemSlug,
): string {
  switch (slug) {
    case 'dumbbells':
      return t('equipmentItems.dumbbells', { defaultValue: 'Dumbbells' });
    case 'barbell':
      return t('equipmentItems.barbell', { defaultValue: 'Barbell (Olympic)' });
    case 'fixed-barbells':
      return t('equipmentItems.fixed-barbells', { defaultValue: 'Fixed-weight barbells' });
    case 'ez-curl-bar':
      return t('equipmentItems.ez-curl-bar', { defaultValue: 'EZ curl bar' });
    case 'trap-bar':
      return t('equipmentItems.trap-bar', { defaultValue: 'Trap (hex) bar' });
    case 'kettlebells':
      return t('equipmentItems.kettlebells', { defaultValue: 'Kettlebells' });
    case 'weight-plates':
      return t('equipmentItems.weight-plates', { defaultValue: 'Weight plates (standalone)' });
    case 'medicine-ball':
      return t('equipmentItems.medicine-ball', { defaultValue: 'Medicine ball' });
    case 'slam-ball':
      return t('equipmentItems.slam-ball', { defaultValue: 'Slam ball' });
    case 'sandbag':
      return t('equipmentItems.sandbag', { defaultValue: 'Sandbag' });
    case 'weighted-vest':
      return t('equipmentItems.weighted-vest', { defaultValue: 'Weighted vest' });
    case 'ankle-wrist-weights':
      return t('equipmentItems.ankle-wrist-weights', { defaultValue: 'Ankle/wrist weights' });
    case 'flat-bench':
      return t('equipmentItems.flat-bench', { defaultValue: 'Flat bench' });
    case 'adjustable-bench':
      return t('equipmentItems.adjustable-bench', { defaultValue: 'Adjustable (incline) bench' });
    case 'decline-bench':
      return t('equipmentItems.decline-bench', { defaultValue: 'Decline bench' });
    case 'squat-rack':
      return t('equipmentItems.squat-rack', { defaultValue: 'Squat rack / power cage' });
    case 'smith-machine':
      return t('equipmentItems.smith-machine', { defaultValue: 'Smith machine' });
    case 'landmine':
      return t('equipmentItems.landmine', { defaultValue: 'Landmine' });
    case 'preacher-bench':
      return t('equipmentItems.preacher-bench', { defaultValue: 'Preacher curl bench' });
    case 'hyperextension-bench':
      return t('equipmentItems.hyperextension-bench', { defaultValue: 'Hyperextension (roman chair)' });
    case 'ghd':
      return t('equipmentItems.ghd', { defaultValue: 'Glute-ham developer (GHD)' });
    case 'pull-up-bar':
      return t('equipmentItems.pull-up-bar', { defaultValue: 'Pull-up bar' });
    case 'dip-station':
      return t('equipmentItems.dip-station', { defaultValue: 'Dip station / parallel bars' });
    case 'assisted-pullup-dip':
      return t('equipmentItems.assisted-pullup-dip', { defaultValue: 'Assisted pull-up/dip machine' });
    case 'gymnastic-rings':
      return t('equipmentItems.gymnastic-rings', { defaultValue: 'Gymnastic rings' });
    case 'parallettes':
      return t('equipmentItems.parallettes', { defaultValue: 'Parallettes / push-up bars' });
    case 'plyo-box':
      return t('equipmentItems.plyo-box', { defaultValue: 'Plyo box' });
    case 'climbing-rope':
      return t('equipmentItems.climbing-rope', { defaultValue: 'Climbing rope' });
    case 'cable-tower':
      return t('equipmentItems.cable-tower', { defaultValue: 'Cable machine / functional trainer' });
    case 'cable-crossover':
      return t('equipmentItems.cable-crossover', { defaultValue: 'Cable crossover (dual stack)' });
    case 'lat-pulldown':
      return t('equipmentItems.lat-pulldown', { defaultValue: 'Lat pulldown machine' });
    case 'seated-row-machine':
      return t('equipmentItems.seated-row-machine', { defaultValue: 'Seated cable row machine' });
    case 'chest-press-machine':
      return t('equipmentItems.chest-press-machine', { defaultValue: 'Chest press machine' });
    case 'pec-deck':
      return t('equipmentItems.pec-deck', { defaultValue: 'Pec deck / rear-delt fly' });
    case 'shoulder-press-machine':
      return t('equipmentItems.shoulder-press-machine', { defaultValue: 'Shoulder press machine' });
    case 'lateral-raise-machine':
      return t('equipmentItems.lateral-raise-machine', { defaultValue: 'Lateral raise machine' });
    case 'row-machine':
      return t('equipmentItems.row-machine', { defaultValue: 'Row machine (iso-lateral/T-bar)' });
    case 'shrug-machine':
      return t('equipmentItems.shrug-machine', { defaultValue: 'Shrug machine' });
    case 'arm-curl-machine':
      return t('equipmentItems.arm-curl-machine', { defaultValue: 'Arm curl machine' });
    case 'triceps-machine':
      return t('equipmentItems.triceps-machine', { defaultValue: 'Triceps extension machine' });
    case 'ab-crunch-machine':
      return t('equipmentItems.ab-crunch-machine', { defaultValue: 'Ab crunch machine' });
    case 'torso-rotation-machine':
      return t('equipmentItems.torso-rotation-machine', { defaultValue: 'Torso rotation machine' });
    case 'back-extension-machine':
      return t('equipmentItems.back-extension-machine', { defaultValue: 'Back extension machine' });
    case 'leg-press':
      return t('equipmentItems.leg-press', { defaultValue: 'Leg press' });
    case 'hack-squat':
      return t('equipmentItems.hack-squat', { defaultValue: 'Hack squat machine' });
    case 'leg-extension-machine':
      return t('equipmentItems.leg-extension-machine', { defaultValue: 'Leg extension machine' });
    case 'leg-curl-machine':
      return t('equipmentItems.leg-curl-machine', { defaultValue: 'Leg curl machine' });
    case 'calf-machine':
      return t('equipmentItems.calf-machine', { defaultValue: 'Calf raise machine' });
    case 'hip-abductor-adductor':
      return t('equipmentItems.hip-abductor-adductor', { defaultValue: 'Hip abductor/adductor machine' });
    case 'glute-machine':
      return t('equipmentItems.glute-machine', { defaultValue: 'Glute kickback / hip thrust machine' });
    case 'reverse-hyper':
      return t('equipmentItems.reverse-hyper', { defaultValue: 'Reverse hyperextension' });
    case 'resistance-bands':
      return t('equipmentItems.resistance-bands', { defaultValue: 'Resistance bands (handles)' });
    case 'loop-bands':
      return t('equipmentItems.loop-bands', { defaultValue: 'Loop / power bands' });
    case 'mini-bands':
      return t('equipmentItems.mini-bands', { defaultValue: 'Mini bands' });
    case 'suspension-trainer':
      return t('equipmentItems.suspension-trainer', { defaultValue: 'Suspension trainer (TRX)' });
    case 'battle-ropes':
      return t('equipmentItems.battle-ropes', { defaultValue: 'Battle ropes' });
    case 'sled':
      return t('equipmentItems.sled', { defaultValue: 'Sled / prowler' });
    case 'tire':
      return t('equipmentItems.tire', { defaultValue: 'Tire' });
    case 'sledgehammer':
      return t('equipmentItems.sledgehammer', { defaultValue: 'Sledgehammer' });
    case 'farmers-handles':
      return t('equipmentItems.farmers-handles', { defaultValue: 'Farmer\'s carry handles' });
    case 'yoke':
      return t('equipmentItems.yoke', { defaultValue: 'Yoke' });
    case 'atlas-stones':
      return t('equipmentItems.atlas-stones', { defaultValue: 'Atlas stones' });
    case 'strongman-misc':
      return t('equipmentItems.strongman-misc', { defaultValue: 'Strongman implements (log, axle, keg, …)' });
    case 'chains':
      return t('equipmentItems.chains', { defaultValue: 'Lifting chains' });
    case 'jump-rope':
      return t('equipmentItems.jump-rope', { defaultValue: 'Jump rope' });
    case 'agility-ladder':
      return t('equipmentItems.agility-ladder', { defaultValue: 'Agility ladder / cones' });
    case 'heavy-bag':
      return t('equipmentItems.heavy-bag', { defaultValue: 'Heavy bag' });
    case 'stability-ball':
      return t('equipmentItems.stability-ball', { defaultValue: 'Stability (exercise) ball' });
    case 'bosu':
      return t('equipmentItems.bosu', { defaultValue: 'BOSU balance trainer' });
    case 'foam-roller':
      return t('equipmentItems.foam-roller', { defaultValue: 'Foam roller' });
    case 'ab-wheel':
      return t('equipmentItems.ab-wheel', { defaultValue: 'Ab wheel' });
    case 'balance-board':
      return t('equipmentItems.balance-board', { defaultValue: 'Balance board' });
    case 'treadmill':
      return t('equipmentItems.treadmill', { defaultValue: 'Treadmill' });
    case 'stationary-bike':
      return t('equipmentItems.stationary-bike', { defaultValue: 'Stationary bike' });
    case 'elliptical':
      return t('equipmentItems.elliptical', { defaultValue: 'Elliptical' });
    case 'rower':
      return t('equipmentItems.rower', { defaultValue: 'Rowing machine' });
    case 'stair-climber':
      return t('equipmentItems.stair-climber', { defaultValue: 'Stair climber' });
    case 'air-bike':
      return t('equipmentItems.air-bike', { defaultValue: 'Air bike' });
    case 'ski-erg':
      return t('equipmentItems.ski-erg', { defaultValue: 'Ski erg' });
  }
}

export function localizeEquipmentItemCategory(
  t: TFunction,
  category: EquipmentItemCategory,
): string {
  switch (category) {
    case 'free weights':
      return t('equipmentItemCategories.free-weights', { defaultValue: 'Free weights' });
    case 'benches & racks':
      return t('equipmentItemCategories.benches-racks', { defaultValue: 'Benches & racks' });
    case 'bodyweight stations':
      return t('equipmentItemCategories.bodyweight-stations', { defaultValue: 'Bodyweight stations' });
    case 'cables':
      return t('equipmentItemCategories.cables', { defaultValue: 'Cables' });
    case 'machines':
      return t('equipmentItemCategories.machines', { defaultValue: 'Machines' });
    case 'bands & suspension':
      return t('equipmentItemCategories.bands-suspension', { defaultValue: 'Bands & suspension' });
    case 'conditioning & strongman':
      return t('equipmentItemCategories.conditioning-strongman', { defaultValue: 'Conditioning & strongman' });
    case 'balance & recovery':
      return t('equipmentItemCategories.balance-recovery', { defaultValue: 'Balance & recovery' });
    case 'cardio':
      return t('equipmentItemCategories.cardio', { defaultValue: 'Cardio' });
  }
}

export function localizeGymTemplate(
  t: TFunction,
  template: GymTemplateSlug,
): string {
  switch (template) {
    case 'planet-fitness':
      return t('gymTemplates.planet-fitness', { defaultValue: 'Planet Fitness' });
    case 'commercial-gym':
      return t('gymTemplates.commercial-gym', { defaultValue: 'Commercial gym' });
    case 'home-basics':
      return t('gymTemplates.home-basics', { defaultValue: 'Home basics' });
    case 'garage-crossfit':
      return t('gymTemplates.garage-crossfit', { defaultValue: 'Garage / CrossFit' });
    case 'hotel-gym':
      return t('gymTemplates.hotel-gym', { defaultValue: 'Hotel gym' });
    case 'bodyweight-only':
      return t('gymTemplates.bodyweight-only', { defaultValue: 'Bodyweight only' });
  }
}
