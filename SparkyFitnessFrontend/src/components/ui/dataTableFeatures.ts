import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFns,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
} from '@tanstack/react-table';

/**
 * The TanStack Table v9 feature set used by every table in the app.
 *
 * v9 made features opt-in: row models and the sort/filter function registries
 * are stitched in statically here rather than being passed per table instance
 * the way v8's `getSortedRowModel()` options were. This must stay module-level
 * (not built inside a component) so the type parameter is stable.
 *
 * The features match what DataTable actually offers: column filtering,
 * sorting, pagination, row selection, and column visibility (which is what
 * supplies getVisibleCells / getVisibleFlatColumns). The full `filterFns` / `sortFns`
 * registries are included so column defs can keep using the built-in string
 * identifiers such as 'includesString' and 'alphanumeric'.
 */
export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filterFns,
  sortFns,
});

/** Feature-bound aliases, so callers write one type parameter instead of two. */
export type DataTableFeatures = typeof dataTableFeatures;
