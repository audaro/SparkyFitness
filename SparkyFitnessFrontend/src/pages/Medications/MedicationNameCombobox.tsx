import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Pill, Plus, Sparkles } from 'lucide-react';
import {
  catalogRowSubtitle,
  rxTermsStrengthHint,
  searchCatalog,
  type CatalogDrug,
  type RxTermsProduct,
} from '@workspace/shared';
import { Input } from '@/components/ui/input';
import { useMedications } from '@/hooks/useMedications';
import { useMedicationCatalogSearch } from '@/hooks/useMedicationCatalogSearch';
import type { Medication } from '@/types/medications';

/**
 * What the user chose. The combobox reports the pick and applies nothing itself — the form
 * owns which fields a pick fills in, and keeping that decision out of here is what makes the
 * dialog's behaviour testable without a dropdown in the way.
 */
export type MedicationNamePick =
  | { kind: 'existing'; medication: Medication }
  | { kind: 'catalog'; drug: CatalogDrug; matchedOn: string }
  | { kind: 'rxterms'; product: RxTermsProduct }
  | { kind: 'custom'; name: string };

/** Rows the user can arrow through. The custom row is always the last one. */
type Row =
  | { key: string; kind: 'existing'; medication: Medication }
  | {
      key: string;
      kind: 'catalog';
      drug: CatalogDrug;
      matchedOn: string;
      viaAlias: boolean;
    }
  | { key: string; kind: 'rxterms'; product: RxTermsProduct }
  | { key: string; kind: 'custom' };

const MAX_OWN = 4;
const MAX_CATALOG = 6;

/**
 * Tier 3 is capped hardest of the three. It is the least specific to this user — a list of every
 * US product, where the two tiers above are their own cabinet and a hand-curated list — so it gets
 * the fewest rows and always sits below them.
 */
const MAX_RXTERMS = 5;

/**
 * The right-hand hint on a tier 3 row, in words. Which of the three cases a product is in is
 * `rxTermsStrengthHint`'s call and is shared with mobile; only the wording is local.
 */
function strengthHintText(
  product: RxTermsProduct,
  t: (key: string, fallback: string, opts?: Record<string, unknown>) => string
): string {
  const hint = rxTermsStrengthHint(product);
  if (!hint) return '';
  return hint.kind === 'single'
    ? `${hint.value} ${hint.unit}`
    : t('medications.search.strengthCount', '{{count}} strengths', {
        count: hint.count,
      });
}

export default function MedicationNameCombobox({
  value,
  onChange,
  onPick,
  placeholder,
  inputId,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  onPick: (pick: MedicationNamePick) => void;
  placeholder?: string;
  inputId?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState({
    query: '',
    rowCount: 0,
    index: 0,
  });
  const containerRef = useRef<HTMLDivElement | null>(null);

  // The user's own cabinet is tier 1. This is the medications list the page already loads, so
  // opening the dropdown costs nothing; `isError` is ignored deliberately — a failed refetch
  // over cached rows should still offer what it has.
  const { data: ownMedications } = useMedications();

  const query = value.trim();

  // Tier 3: the US drug catalog, over the network, only if the user opted in. The hook owns the
  // debounce and the character threshold, and answers with an empty list for every failure — so
  // nothing below has to think about the NIH being down.
  const { products: rxTermsProducts } = useMedicationCatalogSearch(query, {
    limit: MAX_RXTERMS,
    active: open,
  });

  const rows = useMemo<Row[]>(() => {
    // Tiers 1 and 2 are local and free, so they render from the first character rather than
    // waiting on a debounce. Only tier 3 waits, and it waits inside its own hook.
    if (!query) return [];
    const needle = query.toLowerCase();

    const own = (ownMedications ?? [])
      .filter((med) => {
        const haystack = `${med.name} ${med.display_name ?? ''}`.toLowerCase();
        return haystack.includes(needle);
      })
      .slice(0, MAX_OWN)
      .map<Row>((med) => ({
        key: `own:${med.id}`,
        kind: 'existing',
        medication: med,
      }));

    // Do not offer a catalog row for a drug the user already has under that name — the tier-1
    // row above is the same drug with their own strength and schedule already on it.
    const ownNames = new Set(
      own.map((row) =>
        row.kind === 'existing' ? row.medication.name.trim().toLowerCase() : ''
      )
    );

    const catalog = searchCatalog(query, MAX_CATALOG)
      .filter((hit) => !ownNames.has(hit.drug.displayName.toLowerCase()))
      .map<Row>((hit) => ({
        key: `catalog:${hit.drug.id}`,
        kind: 'catalog',
        drug: hit.drug,
        matchedOn: hit.matchedOn,
        viaAlias: hit.viaAlias,
      }));

    // The server already drops any tier 3 product the curated catalog covers. What it cannot know
    // is what the user has in their own cabinet, so the tier 1 filter is repeated here — matched
    // on the base name, since RxTerms displays `Testosterone (Injectable)` where their row says
    // `Testosterone`.
    const rxTerms = rxTermsProducts
      .filter((product) => !ownNames.has(product.baseName.trim().toLowerCase()))
      .slice(0, MAX_RXTERMS)
      .map<Row>((product) => ({
        key: `rxterms:${product.displayName}`,
        kind: 'rxterms',
        product,
      }));

    // The custom row is unconditional and always last. This is the row the peptide user takes,
    // and making them dismiss the dropdown to type a free-text name is the failure this whole
    // control exists to prevent.
    return [...own, ...catalog, ...rxTerms, { key: 'custom', kind: 'custom' }];
  }, [ownMedications, query, rxTermsProducts]);

  // Any change to the result set puts the highlight back on the first row: leaving it where it
  // was would point at a different drug than it did a keystroke ago. Derived during render
  // rather than reset in an effect — the stored index is only honoured while it still belongs to
  // the query and row count that produced it.
  //
  // The row count is part of that and not merely a bounds check. Tier 3 arrives after the list
  // has already rendered and inserts itself *above* the custom row, so a stored index that is
  // still in range can end up pointing somewhere else entirely: a user who arrowed down to "add
  // as custom" and pressed Enter as the lookup landed would add a drug they never chose.
  const activeIndex =
    highlight.query === query && highlight.rowCount === rows.length
      ? highlight.index
      : 0;
  const setActiveIndex = (next: number | ((current: number) => number)) => {
    setHighlight({
      query,
      rowCount: rows.length,
      index: typeof next === 'function' ? next(activeIndex) : next,
    });
  };

  useEffect(() => {
    if (!open) return;
    const onDocumentPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentPointerDown);
    return () =>
      document.removeEventListener('mousedown', onDocumentPointerDown);
  }, [open]);

  const showList = open && rows.length > 0;

  const choose = (row: Row) => {
    if (row.kind === 'existing') {
      onPick({ kind: 'existing', medication: row.medication });
    } else if (row.kind === 'catalog') {
      onPick({
        kind: 'catalog',
        drug: row.drug,
        matchedOn: row.matchedOn,
      });
    } else if (row.kind === 'rxterms') {
      onPick({ kind: 'rxterms', product: row.product });
    } else {
      onPick({ kind: 'custom', name: query });
    }
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList) {
      if (event.key === 'ArrowDown' && rows.length > 0) {
        setOpen(true);
        event.preventDefault();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % rows.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + rows.length) % rows.length);
    } else if (event.key === 'Enter') {
      const row = rows[activeIndex];
      // Only swallow Enter when it is actually selecting something, so the key still submits
      // the surrounding form when the dropdown is closed.
      if (row) {
        event.preventDefault();
        choose(row);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const firstCatalogIndex = rows.findIndex((row) => row.kind === 'catalog');
  const firstRxTermsIndex = rows.findIndex((row) => row.kind === 'rxterms');
  const hasOwn = rows.some((row) => row.kind === 'existing');

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={inputId}
        value={value}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={showList ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          showList ? `${listId}-${activeIndex}` : undefined
        }
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
      {showList && (
        // A plain div, not a ul/li: every role="option" must be a direct child of the
        // listbox, and wrapping each row in an <li> puts a generic element between them.
        <div
          id={listId}
          role="listbox"
          aria-label={t('medications.search.results', 'Medication suggestions')}
          className="absolute z-50 mt-1 w-full max-h-72 overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {rows.map((row, index) => {
            const active = index === activeIndex;
            const rowClass = `flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm cursor-pointer ${
              active ? 'bg-accent text-accent-foreground' : ''
            }`;
            return (
              <Fragment key={row.key}>
                {index === 0 && hasOwn && (
                  <div
                    role="presentation"
                    className="px-2 pt-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {t('medications.search.yours', 'Your medications')}
                  </div>
                )}
                {index === firstCatalogIndex && firstCatalogIndex >= 0 && (
                  <div
                    role="presentation"
                    className="px-2 pt-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {t('medications.search.known', 'Known drugs')}
                  </div>
                )}
                {index === firstRxTermsIndex && firstRxTermsIndex >= 0 && (
                  <div
                    role="presentation"
                    className="flex items-center gap-1.5 px-2 pt-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {t('medications.search.usCatalog', 'US drug catalog')}
                    {/* Named, not just styled. These rows come from someone else's data — the
                        NIH's — and a user comparing a row against their own label deserves to
                        know which list said it. */}
                    <span className="rounded border px-1 text-[10px] font-medium normal-case tracking-normal">
                      {t('medications.search.nlmTag', 'NLM')}
                    </span>
                  </div>
                )}
                {row.kind === 'custom' && (
                  <div role="presentation" className="my-1 border-t" />
                )}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={active}
                  tabIndex={-1}
                  className={rowClass}
                  onMouseEnter={() => setActiveIndex(index)}
                  // mousedown, not click: the input's blur would close the list first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(row);
                  }}
                >
                  {row.kind === 'existing' && (
                    <>
                      <Pill className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">
                        {row.medication.display_name || row.medication.name}
                      </span>
                      {row.medication.strength_value != null && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {row.medication.strength_value}
                          {row.medication.strength_unit ?? ''}
                        </span>
                      )}
                    </>
                  )}
                  {row.kind === 'catalog' && (
                    <>
                      <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">
                        {row.matchedOn}
                        {catalogRowSubtitle(row.drug, row.viaAlias) && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            {catalogRowSubtitle(row.drug, row.viaAlias)}
                          </span>
                        )}
                      </span>
                      {row.drug.cadence && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {row.drug.cadence === 'weekly'
                            ? t('medications.search.weekly', 'weekly')
                            : t('medications.search.daily', 'daily')}
                        </span>
                      )}
                    </>
                  )}
                  {row.kind === 'rxterms' && (
                    <>
                      <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">
                        {row.product.baseName}
                        {row.product.doseForm && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            {row.product.doseForm}
                          </span>
                        )}
                      </span>
                      {/* What the pick is worth, said before it is made. One strength fills the
                          field outright; several mean a choice follows, and the count is the
                          honest way to say so without listing eight products under one name. */}
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {strengthHintText(row.product, t)}
                      </span>
                    </>
                  )}
                  {row.kind === 'custom' && (
                    <>
                      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">
                        {t(
                          'medications.search.addCustom',
                          'Add "{{name}}" as a custom medication',
                          { name: query }
                        )}
                      </span>
                    </>
                  )}
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
