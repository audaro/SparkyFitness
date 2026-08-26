import { describe, expect, it } from 'vitest';
import {
  MEDICATION_CATALOG,
  GLP1_DRUG_PROFILES,
  catalogGenericOf,
  catalogOpensCalculator,
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

  it('cites a label for every number it did not originate, and only those', () => {
    // The provenance invariant. A ladder or a vial hint with no `labelSource` is a number
    // nobody can re-verify and a label revision nobody will notice; a `labelSource` on an
    // entry carrying neither is a citation for nothing, which rots just as quietly.
    for (const drug of Object.values(MEDICATION_CATALOG)) {
      const hasLabelData = drug.strengths !== null || drug.vialSizes.length > 0;
      expect(drug.labelSource !== undefined).toBe(hasLabelData);
      if (!drug.labelSource) continue;
      expect(drug.labelSource.document.length).toBeGreaterThan(0);
      // A day string, so "when was this last checked" is answerable by comparison.
      expect(drug.labelSource.reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('has entries in more categories than the incretins it started as', () => {
    // Phase 3's content pass. Guards against the file quietly reverting to the six PK-registry
    // drugs; the specific categories are asserted rather than a count, because a count passes
    // on six more incretins.
    const categories = new Set(
      Object.values(MEDICATION_CATALOG).map((drug) => drug.category)
    );
    for (const category of [
      'incretin',
      'gh-secretagogue',
      'repair',
      'melanocortin',
      'metabolic',
      'immune',
      'androgen',
    ]) {
      expect(categories).toContain(category);
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

  it('leaves the research peptides with no ladder, no PK and no cadence', () => {
    // The wide half of the catalog. These are the entries `unlabelled()` builds: nothing about
    // them is sourced, so nothing about them may be stated. A regression here is the failure
    // mode the whole split exists to prevent — a confident number in front of someone holding
    // a grey-market vial.
    for (const id of [
      'bpc_157',
      'tb_500',
      'ghk_cu',
      'ipamorelin',
      'cjc_1295_dac',
      'cjc_1295_no_dac',
      'melanotan_ii',
      'aod_9604',
      'kpv',
      'll_37',
      'cagrilintide',
    ]) {
      const drug = MEDICATION_CATALOG[id];
      expect(drug, id).toBeDefined();
      expect(drug.strengths).toBeNull();
      expect(drug.pk).toBeNull();
      expect(drug.glp1ProfileId).toBeUndefined();
      expect(drug.cadence).toBeNull();
      expect(drug.vialSizes).toEqual([]);
    }
  });

  it('prefills the calculator only for products whose label states a vial', () => {
    // `vialSizes` is populated on exactly the entries whose approved product ships as a
    // lyophilized vial the user reconstitutes. Everything else is grey-market packaging with
    // no authoritative size, and an invented hint would prefill the calculator with a number
    // the vendor never supplied.
    const withVials = Object.values(MEDICATION_CATALOG)
      .filter((drug) => drug.vialSizes.length > 0)
      .map((drug) => drug.id)
      .sort();
    expect(withVials).toEqual([
      'hcg',
      'menotropins',
      'tesamorelin',
      'thymosin_alpha_1',
    ]);

    // ...and each of those still has no ladder, so the calculator is what actually opens.
    for (const id of withVials) {
      expect(MEDICATION_CATALOG[id].strengths).toBeNull();
    }
    // IU never converts to mass, so an IU vial has to survive as IU all the way through.
    expect(MEDICATION_CATALOG.hcg.vialSizes).toEqual([
      { amount: 10000, unit: 'iu' },
    ]);
  });
});

describe('catalogOpensCalculator', () => {
  it('opens for an injectable with no ladder — the case it was built for', () => {
    expect(catalogOpensCalculator(MEDICATION_CATALOG.retatrutide)).toBe(true);
    expect(catalogOpensCalculator(MEDICATION_CATALOG.tesamorelin)).toBe(true);
    expect(catalogOpensCalculator(MEDICATION_CATALOG.hcg)).toBe(true);
  });

  it('stays shut for an oral drug with no ladder', () => {
    // Before the content pass every ladder-less entry was injectable, so `strengths === null`
    // was the whole test. These three are the reason it no longer is: a syringe-unit
    // calculator is not an answer to "how much of this capsule".
    for (const id of ['ibutamoren', 'amino_1mq', 'enclomiphene']) {
      expect(MEDICATION_CATALOG[id].strengths, id).toBeNull();
      expect(catalogOpensCalculator(MEDICATION_CATALOG[id]), id).toBe(false);
    }
  });

  it('stays shut wherever a label ladder exists', () => {
    for (const id of ['wegovy', 'rybelsus', 'vyleesi']) {
      expect(catalogOpensCalculator(MEDICATION_CATALOG[id]), id).toBe(false);
    }
  });

  it('opens for a drug that is injectable among other routes', () => {
    // BPC-157 is logged both ways; the injection is the one that needs arithmetic, and the
    // link is still there for anyone whose supply does not match.
    expect(MEDICATION_CATALOG.bpc_157.routes).toContain('oral');
    expect(catalogOpensCalculator(MEDICATION_CATALOG.bpc_157)).toBe(true);
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
      0.25, 0.5, 1, 1.7, 2.4, 7.2,
    ]);
    expect(MEDICATION_CATALOG.ozempic.glp1ProfileId).toBe(
      MEDICATION_CATALOG.wegovy.glp1ProfileId
    );
  });

  it('gives one brand name to two products when the label does', () => {
    // Ozempic and Wegovy each label an injection and a tablet, on one FDA document apiece.
    // Same brand name, different molecule, different ladder, different route — so different
    // entries. Collapsing either pair would put an oral ladder on an injection record.
    expect(MEDICATION_CATALOG.wegovy.genericId).toBe('semaglutide');
    expect(MEDICATION_CATALOG.wegovy_tablets.genericId).toBe(
      'oral_semaglutide'
    );
    expect(MEDICATION_CATALOG.wegovy_tablets.strengths?.values).toEqual([
      1.5, 4, 9, 25,
    ]);
    expect(MEDICATION_CATALOG.ozempic_tablets.strengths?.values).toEqual([
      1.5, 4, 9,
    ]);
    // Rybelsus shares the tablets' document and molecule but not its ladder, which is the
    // reason it is a third entry rather than an alias.
    expect(MEDICATION_CATALOG.rybelsus.strengths?.values).toEqual([3, 7, 14]);
    expect(MEDICATION_CATALOG.rybelsus.genericId).toBe('oral_semaglutide');
  });

  it('splits a brand outside the incretins on exactly the same rule', () => {
    // Vyleesi is the melanocortin case: a one-value ladder is still a ladder, so the brand is
    // an entry and the chip row replaces the calculator. Someone holding a grey-market PT-141
    // vial picks the molecule and gets the calculator instead.
    expect(MEDICATION_CATALOG.vyleesi.strengths?.values).toEqual([1.75]);
    expect(MEDICATION_CATALOG.vyleesi.genericId).toBe('bremelanotide');
    expect(MEDICATION_CATALOG.bremelanotide.strengths).toBeNull();
    // Neither has PK: the registry is GLP-1 only, and a melanocortin must not draw a curve.
    expect(MEDICATION_CATALOG.vyleesi.pk).toBeNull();
  });

  it('keeps a brand without a ladder as an alias rather than a second entry', () => {
    // Egrifta's label adds a vial size, not a ladder, and a vial size is the same fact
    // whoever supplied the powder — so splitting it would buy a duplicate row and nothing.
    expect(MEDICATION_CATALOG.egrifta).toBeUndefined();
    expect(resolveCatalogDrug('Egrifta')?.id).toBe('tesamorelin');
    expect(MEDICATION_CATALOG.tesamorelin.vialSizes).toEqual([
      { amount: 2, unit: 'mg' },
      { amount: 11.6, unit: 'mg' },
    ]);
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
    // The bug this guards: leaving 'Zepbound' on tirzepatide's aliases returns two rows for one
    // query — the brand, and the molecule wearing the brand's name.
    const ids = searchCatalog('Zepbound').map((hit) => hit.drug.id);
    expect(ids).toEqual(['zepbound']);
  });

  it('offers both products when one brand name really covers two', () => {
    // Not the bug above: Novo labels a Wegovy injection and a Wegovy tablet, so a user typing
    // the name genuinely has two things to choose between and has to pick the one they hold.
    // The injection outranks the tablet because its name matches exactly.
    const ids = searchCatalog('Wegovy').map((hit) => hit.drug.id);
    expect(ids).toEqual(['wegovy', 'wegovy_tablets']);
    expect(searchCatalog('Ozempic').map((hit) => hit.drug.id)).toEqual([
      'ozempic',
      'ozempic_tablets',
    ]);
    // Their subtitles are what tell the two apart in the list.
    expect(catalogRowSubtitle(MEDICATION_CATALOG.wegovy, false)).toBe(
      'Semaglutide'
    );
    expect(catalogRowSubtitle(MEDICATION_CATALOG.wegovy_tablets, false)).toBe(
      'Semaglutide (oral)'
    );
  });

  it('finds the peptides the content pass added, by name and by synonym', () => {
    expect(searchCatalog('BPC-157')[0]?.drug.id).toBe('bpc_157');
    expect(searchCatalog('MK-677')[0]?.drug.id).toBe('ibutamoren');
    expect(searchCatalog('PT-141')[0]?.drug.id).toBe('bremelanotide');
    expect(searchCatalog('hCG')[0]?.drug.id).toBe('hcg');
    // A synonym match names the drug under the row, so the row is not left unexplained.
    const [mk] = searchCatalog('MK-677');
    expect(mk?.viaAlias).toBe(true);
    expect(catalogRowSubtitle(mk!.drug, mk!.viaAlias)).toBe(
      'Ibutamoren (MK-677)'
    );
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

describe('searchCatalog — the typo fallback', () => {
  it('finds the drug behind a transposition', () => {
    // The commonest way a typed drug name goes wrong: two adjacent letters swapped. Before the
    // fuzzy pass these returned nothing at all, which for a peptide meant nothing anywhere —
    // RxTerms carries none of them either.
    expect(searchCatalog('retatrutdie')[0]?.drug.id).toBe('retatrutide');
    expect(searchCatalog('tirzepatdie')[0]?.drug.id).toBe('tirzepatide');
    expect(searchCatalog('ipamorleni')[0]?.drug.id).toBe('ipamorelin');
  });

  it('finds the drug behind a dropped or doubled letter', () => {
    expect(searchCatalog('semaglutde')[0]?.drug.id).toBe('semaglutide');
    expect(searchCatalog('ozempicc')[0]?.drug.id).toBe('ozempic');
  });

  it('says a row is a near miss so the UI can', () => {
    const [hit] = searchCatalog('retatrutdie');
    expect(hit?.viaTypo).toBe(true);
    // And an ordinary match is not marked, so the caveat only appears where it is earned.
    expect(searchCatalog('retatrutide')[0]?.viaTypo).toBe(false);
  });

  it('never competes with a real match', () => {
    // The rule the substring-only comment was protecting: as long as one drug contains what was
    // typed, no misspelling of another may appear beside it. 'tide' matches several molecules
    // by substring; nothing fuzzy may join them.
    const hits = searchCatalog('tide');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => !hit.viaTypo)).toBe(true);
  });

  it('reaches a drug through a misspelled synonym', () => {
    // 'MK-67' would be a plain substring of 'MK-677'; this is the digits transposed.
    const [hit] = searchCatalog('MK-767');
    expect(hit?.drug.id).toBe('ibutamoren');
    expect(hit?.viaTypo).toBe(true);
    expect(hit?.viaAlias).toBe(true);
  });

  it('ranks the closest spelling first', () => {
    // Distance is a real comparison and it is the one that decides the row order, so the drug
    // one edit away outranks anything two edits away.
    const ids = searchCatalog('semaglutde').map((hit) => hit.drug.id);
    expect(ids[0]).toBe('semaglutide');
  });

  it('refuses to guess at a term too short to be a misspelling', () => {
    // Three characters is someone typing, not someone erring — and at that length half the
    // catalog is within an edit of half the alphabet.
    expect(searchCatalog('xyz')).toEqual([]);
    expect(searchCatalog('hcx')).toEqual([]);
  });

  it('still returns nothing for a term that is not a drug name at all', () => {
    expect(searchCatalog('grocery list')).toEqual([]);
    expect(searchCatalog('zzzzqqqqxxxx')).toEqual([]);
  });

  it('never surfaces an inherited Object property through the fuzzy pass either', () => {
    for (const term of ['constructor', 'toString', '__proto__', 'valueOf']) {
      expect(searchCatalog(term)).toEqual([]);
    }
  });

  it('honours the limit', () => {
    expect(searchCatalog('semaglutde', 1).length).toBeLessThanOrEqual(1);
  });
});
