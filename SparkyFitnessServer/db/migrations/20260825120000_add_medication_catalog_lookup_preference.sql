-- Medication autofill, tier 3: the RxTerms opt-in.
--
-- The medication search has three tiers. Tiers 1 and 2 (the user's own cabinet and the bundled
-- catalog in shared/src/medications/catalog.ts) are local, offline and always on. Tier 3 queries
-- the NLM RxTerms catalog, which means a medication name leaves the user's server.
--
-- DEFAULT FALSE, deliberately. The original medications migration reserved this with the comment
-- "-- only set if user enabled lookups" on medications.rxnorm_rxcui; this column is that setting.
-- Off means tiers 1-2 only, which still covers this app's GLP-1 and peptide core completely — so
-- the default costs the user nothing they came here for, and opting in is a decision they make
-- about their own data rather than one made for them.
--
-- No RLS change: user_preferences already has row-level policies scoping rows to their owner, and
-- a new column on an existing table inherits them. The table's security tier is unchanged.

ALTER TABLE "public"."user_preferences"
ADD COLUMN IF NOT EXISTS "medication_catalog_lookup_enabled" BOOLEAN NOT NULL DEFAULT false;
