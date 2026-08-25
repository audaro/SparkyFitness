import { describe, expect, it } from 'vitest';
import {
  MEDICATION_CATALOG,
  GLP1_DRUG_PROFILES,
  resolveCatalogDrug,
  resolveGlp1Profile,
} from '@workspace/shared';

describe('medication catalog — shape invariants', () => {
  it('keys every entry by its own id', () => {
    for (const [key, drug] of Object.entries(MEDICATION_CATALOG)) {
      expect(drug.id).toBe(key);
    }
  });

  it('only ever labels a strength ladder as label-derived', () => {
    // The type permits exactly one source; this asserts the data agrees, so a hand-edit
    // that widens the union has to break a test as well as the compiler.
    for (const drug of Object.values(MEDICATION_CATALOG)) {
      if (drug.strengths) {
        expect(drug.strengths.source).toBe('label');
        expect(drug.strengths.values.length).toBeGreaterThan(0);
      }
    }
  });

  it('never states a vial size that is not a positive number', () => {
    for (const drug of Object.values(MEDICATION_CATALOG)) {
      for (const vial of drug.vialSizes) {
        expect(vial.amount).toBeGreaterThan(0);
        expect(['mg', 'mcg', 'iu']).toContain(vial.unit);
      }
    }
  });

  it('gives every entry at least one route', () => {
    for (const drug of Object.values(MEDICATION_CATALOG)) {
      expect(drug.routes.length).toBeGreaterThan(0);
    }
  });
});

describe('medication catalog — PK is not duplicated, it is referenced', () => {
  it('carries pk exactly when it names a GLP-1 profile', () => {
    for (const drug of Object.values(MEDICATION_CATALOG)) {
      expect(drug.pk === null).toBe(drug.glp1ProfileId === undefined);
    }
  });

  it('matches the registry it references, so the two cannot drift', () => {
    for (const drug of Object.values(MEDICATION_CATALOG)) {
      if (!drug.glp1ProfileId) continue;

      const profile = GLP1_DRUG_PROFILES[drug.glp1ProfileId];
      expect(profile).toBeDefined();
      expect(drug.pk).toEqual({
        halfLifeDays: profile.halfLifeDays,
        tMaxDays: profile.tMaxDays,
      });
    }
  });

  it('never publishes a non-positive half-life', () => {
    for (const drug of Object.values(MEDICATION_CATALOG)) {
      if (!drug.pk) continue;
      expect(drug.pk.halfLifeDays).toBeGreaterThan(0);
      expect(drug.pk.tMaxDays).toBeGreaterThan(0);
    }
  });

  it('covers every drug in the PK registry', () => {
    // Phase 0 migrates the GLP-1 entries across; nothing in the registry should be
    // unreachable from search. (The reverse does not hold — the catalog is the wider list.)
    const covered = new Set(
      Object.values(MEDICATION_CATALOG)
        .map((d) => d.glp1ProfileId)
        .filter((id): id is string => Boolean(id))
    );
    for (const id of Object.keys(GLP1_DRUG_PROFILES)) {
      expect(covered.has(id)).toBe(true);
    }
  });
});

describe('medication catalog — the peptide case the split exists for', () => {
  it('offers retatrutide with published PK but no originated strength ladder', () => {
    const reta = MEDICATION_CATALOG.retatrutide;

    expect(reta).toBeDefined();
    expect(reta.pk).not.toBeNull();
    // Investigational: no approved label, so the calculator is the dosage step.
    expect(reta.strengths).toBeNull();
  });

  it('does not originate a dose for any drug without an approved label', () => {
    for (const drug of Object.values(MEDICATION_CATALOG)) {
      if (drug.strengths === null) continue;
      expect(drug.strengths.source).toBe('label');
    }
  });
});

describe('resolveCatalogDrug', () => {
  it('resolves by id, display name and alias, case-insensitively', () => {
    expect(resolveCatalogDrug('retatrutide')?.id).toBe('retatrutide');
    expect(resolveCatalogDrug('Retatrutide')?.id).toBe('retatrutide');
    expect(resolveCatalogDrug('Reta')?.id).toBe('retatrutide');
    expect(resolveCatalogDrug('reta')?.id).toBe('retatrutide');
    expect(resolveCatalogDrug('Wegovy')?.id).toBe('semaglutide');
    expect(resolveCatalogDrug('MOUNJARO')?.id).toBe('tirzepatide');
  });

  it('tolerates surrounding whitespace', () => {
    expect(resolveCatalogDrug('  Wegovy  ')?.id).toBe('semaglutide');
  });

  it('returns undefined for an unknown or empty term', () => {
    expect(resolveCatalogDrug('not-a-drug')).toBeUndefined();
    expect(resolveCatalogDrug('')).toBeUndefined();
    expect(resolveCatalogDrug('   ')).toBeUndefined();
  });

  it.each([
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    '__proto__',
  ])('does not resolve the inherited Object property %s to a drug', (term) => {
    // A bare `CATALOG[key]` returns a truthy Function for these, handing the caller a
    // "drug" with no id, no name and no PK. Both resolvers must miss instead.
    expect(resolveCatalogDrug(term)).toBeUndefined();
    expect(resolveGlp1Profile(term)).toBeUndefined();
  });

  it('agrees with resolveGlp1Profile wherever both know the drug', () => {
    for (const term of ['Wegovy', 'Ozempic', 'Mounjaro', 'Trulicity', 'reta']) {
      const drug = resolveCatalogDrug(term);
      const profile = resolveGlp1Profile(term);
      if (drug?.glp1ProfileId && profile) {
        expect(drug.glp1ProfileId).toBe(profile.id);
      }
    }
  });
});
