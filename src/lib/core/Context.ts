import { writable, derived, type Writable, type Readable } from 'svelte/store';
import type { Params } from '../DataHandler';
import type { Sorted } from './Handlers/Rows';
import { check } from './Comparator';

export type FilterBy<T> = keyof T | ((row: T) => T[keyof T]);
export type FilterValue<T, FB extends FilterBy<T>> = FB extends keyof T
    ? T[FB]
    : FB extends (row: T) => infer V
    ? V
    : never;

export type Comparator<T> = (...args: any) => any;
export interface Filter<T> {
    filterBy: (row: T) => T[keyof T];
    value?: string | number;
    compare: any;
    identifier: string;
}

export interface RowCount {
    total: number;
    start: number;
    end: number;
}

export default class Context<TRow> {
    public rowsPerPage: Writable<number | null>;
    public pageNumber: Writable<number>;
    public triggerChange: Writable<number>;
    public globalSearch: Writable<{ value: string | null; scope: string[] | null }>;
    public filters: Writable<Filter<TRow>[]>;
    public rawRows: Writable<TRow[]>;
    public filteredRows: Readable<TRow[]>;
    public rows: Readable<TRow[]>;
    public rowCount: Readable<RowCount>;
    public pages: Readable<number[]>;
    public pagesWithEllipsis: Readable<number[]>;
    public pageCount: Readable<number>;
    public sorted: Writable<Sorted<TRow>>;
    public selected: Writable<TRow[]>;
    public selectScope: Writable<'all' | 'currentPage'>;
    public isAllSelected: Readable<boolean>;

    constructor(data: TRow[], params: Params) {
        this.rowsPerPage = writable(params.rowsPerPage);
        this.pageNumber = writable(1);
        this.triggerChange = writable(0);
        this.globalSearch = writable({ value: null, scope: null });
        this.filters = writable([]);
        this.rawRows = writable(data);
        this.filteredRows = this.createFilteredRows();
        this.rows = this.createPaginatedRows();
        this.rowCount = this.createRowCount();
        this.pages = this.createPages();
        this.pagesWithEllipsis = this.createPagesWithEllipsis();
        this.pageCount = this.createPageCount();
        this.sorted = writable({ identifier: null, direction: null, fn: null });
        this.selected = writable([]);
        this.selectScope = writable('all');
        this.isAllSelected = this.createIsAllSelected();
    }

    private createFilteredRows() {
        return derived(
            [this.rawRows, this.globalSearch, this.filters],
            ([$rawRows, $globalSearch, $filters]) => {
                if ($globalSearch.value) {
                    $rawRows = $rawRows.filter((row) => {
                        const scope = $globalSearch.scope ?? Object.keys(row);
                        return scope.some((key) => {
                            return this.matches(row[key], $globalSearch.value);
                        });
                    });
                    this.pageNumber.set(1);
                    this.selected.set([]);
                    this.triggerChange.update((store) => {
                        return store + 1;
                    });
                }

                if ($filters.length > 0) {
                    $filters.forEach((localFilter) => {
                        return ($rawRows = $rawRows.filter((row) => {
                            const entry = localFilter.filterBy(row);
                            if (
                                localFilter.value === null ||
                                localFilter.value === undefined ||
                                localFilter.value === ''
                            )
                                return true;
                            return this.matches(entry, localFilter.value, localFilter.compare);
                        }));
                    });
                    this.pageNumber.set(1);
                    this.selected.set([]);
                    this.triggerChange.update((store) => {
                        return store + 1;
                    });
                }
                return $rawRows;
            }
        );
    }

    private matches(
        entry: string | Record<string, any> | number | null,
        value: string | number,
        compare: ((...args: any) => number) | null = null
    ) {
        if (!entry && compare) {
            return compare(entry, value);
        }
        if (!entry) return check.contains(entry, value);
        else if (typeof entry === 'object') {
            return Object.keys(entry).some((k) => {
                return this.matches(entry[k], value, compare);
            });
        }
        if (!compare) return check.contains(entry, value);
        return compare(entry, value);
    }

    private createPaginatedRows() {
        return derived(
            [this.filteredRows, this.rowsPerPage, this.pageNumber],
            ([$filteredRows, $rowsPerPage, $pageNumber]) => {
                if (!$rowsPerPage) {
                    return $filteredRows;
                }
                this.triggerChange.update((store) => {
                    return store + 1;
                });
                return $filteredRows.slice(
                    ($pageNumber - 1) * $rowsPerPage,
                    $pageNumber * $rowsPerPage
                );
            }
        );
    }

    private createRowCount() {
        return derived(
            [this.filteredRows, this.pageNumber, this.rowsPerPage],
            ([$filteredRows, $pageNumber, $rowsPerPage]) => {
                const total = $filteredRows.length;

                if (!$rowsPerPage) {
                    return { total: total, start: 1, end: total };
                }
                return {
                    total: total,
                    start: $pageNumber * $rowsPerPage - $rowsPerPage + 1,
                    end: Math.min($pageNumber * $rowsPerPage, $filteredRows.length)
                };
            }
        );
    }

    private createPages() {
        return derived([this.rowsPerPage, this.filteredRows], ([$rowsPerPage, $filteredRows]) => {
            if (!$rowsPerPage) {
                return [1];
            }
            const pages = Array.from(Array(Math.ceil($filteredRows.length / $rowsPerPage)));
            return pages.map((row, i) => {
                return i + 1;
            });
        });
    }

    private createPagesWithEllipsis() {
        return derived([this.pages, this.pageNumber], ([$pages, $pageNumber]) => {
            if ($pages.length <= 7) {
                return $pages;
            }
            const ellipse = null;
            const firstPage = 1;
            const lastPage = $pages.length;
            if ($pageNumber <= 4) {
                return [...$pages.slice(0, 5), ellipse, lastPage];
            } else if ($pageNumber < $pages.length - 3) {
                return [
                    firstPage,
                    ellipse,
                    ...$pages.slice($pageNumber - 2, $pageNumber + 1),
                    ellipse,
                    lastPage
                ];
            } else {
                return [firstPage, ellipse, ...$pages.slice($pages.length - 5, $pages.length)];
            }
        });
    }

    private createPageCount() {
        return derived(this.pages, ($pages) => {
            return $pages.length;
        });
    }

    private createIsAllSelected() {
        return derived(
            [this.selected, this.rows, this.filteredRows, this.selectScope],
            ([$selected, $rows, $filteredRows, $selectScope]) => {
                const rowCount =
                    $selectScope === 'currentPage' ? $rows.length : $filteredRows.length;
                if (rowCount === $selected.length && rowCount !== 0) {
                    return true;
                }
                return false;
            }
        );
    }
}
