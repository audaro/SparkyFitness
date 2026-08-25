import { describe, expect, it } from 'vitest';
import {
  MEDICATION_CATALOG,
  GLP1_DRUG_PROFILES,
  catalogGenericOf,
  catalogRowSubtitle,
  resolveCatalogDrug,
  resolveGlp1Profile,
  searchCatalog,
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

describe('medication catalog — brands are their own entries', () => {
  const brands = Object.values(MEDICATION_CATALOG).filter(
    (drug) => drug.genericId !== undefined
  );
  const generics = Object.values(MEDICATION_CATALOG).filter(
    (drug) => drug.genericId === undefined
  );

  it('has brands at all, so the rest of this block is not vacuously true', () => {
    expect(brands.length).toBeGreaterThan(0);
    expect(generics.length).toBeGreaterThan(0);
  });

  it('points every brand at a molecule that exists', () => {
    for (const brand of brands) {
      const generic = catalogGenericOf(brand);
      expect(generic).not.toBeNull();
      expect(generic?.id).toBe(brand.genericId);
      // A molecule is not a brand of something else; the link is one level deep.
      expect(generic?.genericId).toBeUndefined();
    }
  });

  it('gives a brand the same PK and profile as its molecule', () => {
    // The whole premise of the split: the ladder belongs to the label, the pharmacokinetics
    // belong to the molecule. A brand that drifted here would draw a different serum curve
    // from the same drug under another name.
    for (const brand of brands) {
      const generic = catalogGenericOf(brand);
      expect(brand.pk).toEqual(generic?.pk);
      expect(brand.glp1ProfileId).toBe(generic?.glp1ProfileId);
      expect(brand.category).toBe(generic?.category);
      expect(brand.routes).toEqual(generic?.routes);
      expect(brand.cadence).toBe(generic?.cadence);
    }
  });

  it('gives every brand the label ladder that is its reason for existing', () => {
    for (const brand of brands) {
      expect(brand.strengths).not.toBeNull();
      const values = brand.strengths?.values ?? [];
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) expect(value).toBeGreaterThan(0);
      // Ascending, so the UI can render it as a titration ladder without sorting it.
      expect([...values].sort((a, b) => a - b)).toEqual(values);
      expect(brand.strengths?.unit).toBe('mg');
    }
  });

  it('leaves every molecule without a ladder', () => {
    // A molecule has no label, so it has no strengths — that is the compounded-vial case the
    // reconstitution calculator exists for.
    for (const generic of generics) {
      expect(generic.strengths).toBeNull();
    }
  });

  it('separates the two semaglutide ladders that forced the split', () => {
    expect(MEDICATION_CATALOG.ozempic.strengths?.values).toEqual([
      0.25, 0.5, 1, 2,
    ]);
    expect(MEDICATION_CATALOG.wegovy.strengths?.values).toEqual([
      0.25, 0.5, 1, 1.7, 2.4,
    ]);
    expect(MEDICATION_CATALOG.ozempic.glp1ProfileId).toBe(
      MEDICATION_CATALOG.wegovy.glp1ProfileId
    );
  });

  it("never lets one entry answer to another entry's name", () => {
    // The duplicate-row guard: an alias colliding with some other entry's id or display name
    // means one query returns two rows for what the user thinks is one drug.
    const names = new Map<string, string>();
    for (const drug of Object.values(MEDICATION_CATALOG)) {
      for (const name of [drug.id, drug.displayName]) {
        const key = name.toLowerCase();
        // An entry naturally answers to both its own id and its own name ('ozempic' /
        // 'Ozempic'); what must never happen is two *different* entries sharing one.
        expect(names.get(key) ?? drug.id).toBe(drug.id);
        names.set(key, drug.id);
      }
    }
    for (const drug of Object.values(MEDICATION_CATALOG)) {
      for (const alias of drug.aliases) {
        const owner = names.get(alias.toLowerCase());
        expect(owner === undefined || owner === drug.id).toBe(true);
      }
    }
  });

  it('names the molecule under a brand row and says nothing extra under its own', () => {
    expect(catalogRowSubtitle(MEDICATION_CATALOG.zepbound, false)).toBe(
      'Tirzepatide'
    );
    // A brand's subtitle is its molecule whether or not an alias did the matching.
    expect(catalogRowSubtitle(MEDICATION_CATALOG.zepbound, true)).toBe(
      'Tirzepatide'
    );
    // A molecule matched by its own name needs no second line...
    expect(
      catalogRowSubtitle(MEDICATION_CATALOG.semaglutide, false)
    ).toBeNull();
    // ...but one matched on 'Sema' names itself, so the row is not left unexplained.
    expect(catalogRowSubtitle(MEDICATION_CATALOG.semaglutide, true)).toBe(
      'Semaglutide'
    );
  });

  it('refuses to resolve a dangling generic link rather than inventing a drug', () => {
    expect(() =>
      catalogGenericOf({
        ...MEDICATION_CATALOG.wegovy,
        genericId: 'not-a-molecule',
      })
    ).toThrow(/not in the catalog/);
  });
});

describe('resolveCatalogDrug', () => {
  it('resolves by id, display name and alias, case-insensitively', () => {
    expect(resolveCatalogDrug('retatrutide')?.id).toBe('retatrutide');
    expect(resolveCatalogDrug('Retatrutide')?.id).toBe('retatrutide');
    expect(resolveCatalogDrug('Reta')?.id).toBe('retatrutide');
    expect(resolveCatalogDrug('reta')?.id).toBe('retatrutide');
    // A brand is its own entry now, because its strength ladder is its own.
    expect(resolveCatalogDrug('Wegovy')?.id).toBe('wegovy');
    expect(resolveCatalogDrug('MOUNJARO')?.id).toBe('mounjaro');
    // The molecule is still reachable under its own name — that is the compounded-vial case.
    expect(resolveCatalogDrug('semaglutide')?.id).toBe('semaglutide');
  });

  it('still resolves the ids already written to saved medications', () => {
    // Rows created before the brand split carry the molecule's id in
    // custom_fields.catalog_id. Those entries did not move, so nothing needs migrating.
    for (const id of [
      'semaglutide',
      'oral_semaglutide',
      'tirzepatide',
      'dulaglutide',
      'liraglutide',
      'retatrutide',
    ]) {
      expect(resolveCatalogDrug(id)?.id).toBe(id);
    }
  });

  it('tolerates surrounding whitespace', () => {
    expect(resolveCatalogDrug('  Wegovy  ')?.id).toBe('wegovy');
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

describe('searchCatalog', () => {
  it('finds a drug by an exact brand the user is likelier to know', () => {
    const [hit] = searchCatalog('Wegovy');
    expect(hit?.drug.id).toBe('wegovy');
    // The row shows what they typed, not a rename to the generic name.
    expect(hit?.matchedOn).toBe('Wegovy');
    // Its own entry, so this is a name match rather than an alias one — the molecule reaches
    // the row through the subtitle instead.
    expect(hit?.viaAlias).toBe(false);
    expect(catalogRowSubtitle(hit!.drug, hit!.viaAlias)).toBe('Semaglutide');
  });

  it('offers one row per brand, not a brand and a molecule pretending to be it', () => {
    // The bug this guards: leaving 'Wegovy' on semaglutide's aliases returns two rows for one
    // query — the brand, and the molecule wearing the brand's name.
    const ids = searchCatalog('Wegovy').map((hit) => hit.drug.id);
    expect(ids).toEqual(['wegovy']);
  });

  it('matches a partial name as the user types it', () => {
    const ids = searchCatalog('reta').map((hit) => hit.drug.id);
    expect(ids).toContain('retatrutide');
  });

  it('ranks the drug name above a brand at the same tier', () => {
    // 'Semaglutide' is a prefix match on the name; nothing else may outrank it.
    const [first] = searchCatalog('semaglutide');
    expect(first?.drug.id).toBe('semaglutide');
    expect(first?.viaAlias).toBe(false);
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(searchCatalog('  OZEMPIC ')[0]?.drug.id).toBe('ozempic');
  });

  it('returns nothing for a blank query rather than the whole catalog', () => {
    expect(searchCatalog('')).toEqual([]);
    expect(searchCatalog('   ')).toEqual([]);
  });

  it('honours the limit and never returns more rows than asked for', () => {
    expect(searchCatalog('a', 2).length).toBeLessThanOrEqual(2);
    expect(searchCatalog('a', 0)).toEqual([]);
  });

  it('never surfaces an inherited Object property as a drug', () => {
    for (const term of ['constructor', 'toString', '__proto__', 'valueOf']) {
      expect(searchCatalog(term)).toEqual([]);
    }
  });

  it('is stable across the same query', () => {
    expect(searchCatalog('tide').map((hit) => hit.drug.id)).toEqual(
      searchCatalog('tide').map((hit) => hit.drug.id)
    );
  });
});
