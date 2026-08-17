import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/states';
import { cn } from '@/lib/utils';
/**
 * Optional `server` prop: hand the table a backend that already did the
 * searching, sorting and paging, and it renders `data` verbatim while driving
 * the same search box and pager controls through your callbacks. Omit it and
 * the table behaves exactly as before — filtering, sorting and paging in the
 * browser over whatever `data` it was given.
 *
 *   server = { query, onQueryChange, page, pageCount, total, onPageChange, loading }
 *
 * `page` is 1-based here, matching the API; internally the client mode stays
 * 0-based. `loading` suppresses the empty state so a fetch in flight does not
 * flash "No results".
 */
export function DataTable({ columns, data, getRowId, searchable = true, searchPlaceholder = 'Search…', searchAccessor, pageSize = 8, toolbar, rowActions, emptyTitle = 'No results', emptyDescription = 'Try adjusting your search or filters.', className, server, }) {
    const [query, setQuery] = useState('');
    const [sortKey, setSortKey] = useState(null);
    const [sortDir, setSortDir] = useState('asc');
    const [page, setPage] = useState(0);
    const filtered = useMemo(() => {
        // Server mode has already filtered; re-filtering would hide rows the
        // backend matched on a field this accessor cannot see (e.g. a brand).
        if (server || !query || !searchAccessor)
            return data;
        const q = query.toLowerCase();
        return data.filter((row) => searchAccessor(row).toLowerCase().includes(q));
    }, [data, query, searchAccessor, server]);
    const sorted = useMemo(() => {
        if (!sortKey)
            return filtered;
        const col = columns.find((c) => c.key === sortKey);
        if (!col)
            return filtered;
        const getVal = (row) => {
            if (col.sortValue)
                return col.sortValue(row);
            if (col.accessor)
                return col.accessor(row);
            const v = row[sortKey];
            return typeof v === 'number' ? v : String(v ?? '');
        };
        return [...filtered].sort((a, b) => {
            const av = getVal(a);
            const bv = getVal(b);
            const cmp = typeof av === 'number' && typeof bv === 'number'
                ? av - bv
                : String(av).localeCompare(String(bv));
            return sortDir === 'asc' ? cmp : -cmp;
        });
    }, [filtered, sortKey, sortDir, columns]);
    // In server mode the page the backend returned IS the page to render.
    const pageCount = server ? Math.max(1, server.pageCount ?? 1) : Math.max(1, Math.ceil(sorted.length / pageSize));
    const safePage = server ? Math.min(Math.max(0, (server.page ?? 1) - 1), pageCount - 1) : Math.min(page, pageCount - 1);
    const paged = server ? data : sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);
    const totalRows = server ? (server.total ?? data.length) : sorted.length;
    const searchValue = server ? (server.query ?? '') : query;
    const onSearch = (value) => {
        if (server)
            server.onQueryChange?.(value);
        else {
            setQuery(value);
            setPage(0);
        }
    };
    const goToPage = (next) => {
        if (server)
            server.onPageChange?.(Math.min(pageCount, Math.max(1, next + 1)));
        else
            setPage(Math.min(pageCount - 1, Math.max(0, next)));
    };
    const toggleSort = (key) => {
        if (sortKey === key) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        }
        else {
            setSortKey(key);
            setSortDir('asc');
        }
    };
    const alignClass = (a) => a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';
    return (<div className={cn('flex flex-col gap-4', className)}>
      {(searchable || toolbar) && (<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {searchable && (searchAccessor || server) ? (<div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/>
              <Input value={searchValue} onChange={(e) => onSearch(e.target.value)} placeholder={searchPlaceholder} className="pl-9" aria-label="Search table"/>
            </div>) : (<div />)}
          {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
        </div>)}

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="max-h-[560px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {columns.map((col) => (<TableHead key={col.key} className={cn(alignClass(col.align), col.headerClassName)}>
                    {col.sortable ? (<button type="button" onClick={() => toggleSort(col.key)} className={cn('inline-flex items-center gap-1 rounded-md transition-colors hover:text-foreground', col.align === 'right' && 'flex-row-reverse')}>
                        {col.header}
                        {sortKey === col.key ? (sortDir === 'asc' ? (<ArrowUp className="size-3.5"/>) : (<ArrowDown className="size-3.5"/>)) : (<ChevronsUpDown className="size-3.5 opacity-50"/>)}
                      </button>) : (col.header)}
                  </TableHead>))}
                {rowActions && <TableHead className="w-12"/>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((row) => (<TableRow key={getRowId(row)}>
                  {columns.map((col) => (<TableCell key={col.key} className={cn(alignClass(col.align), col.className)}>
                      {col.cell
                    ? col.cell(row)
                    : String(row[col.key] ?? '')}
                    </TableCell>))}
                  {rowActions && (<TableCell className="text-right">{rowActions(row)}</TableCell>)}
                </TableRow>))}
            </TableBody>
          </Table>
        </div>

        {paged.length === 0 && !server?.loading && (<EmptyState title={emptyTitle} description={emptyDescription} className="rounded-none border-0 border-t"/>)}
      </div>

      {totalRows > pageSize && (<div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
          <span className="tabular">
            {safePage * pageSize + 1}–
            {Math.min((safePage + 1) * pageSize, totalRows)} of{' '}
            {totalRows}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon-sm" disabled={safePage === 0} onClick={() => goToPage(safePage - 1)} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <span className="tabular text-xs">
              Page {safePage + 1} / {pageCount}
            </span>
            <Button variant="outline" size="icon-sm" disabled={safePage >= pageCount - 1} onClick={() => goToPage(safePage + 1)} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        </div>)}
    </div>);
}
