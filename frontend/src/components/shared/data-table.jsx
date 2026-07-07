import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/states';
import { cn } from '@/lib/utils';
export function DataTable({ columns, data, getRowId, searchable = true, searchPlaceholder = 'Search…', searchAccessor, pageSize = 8, toolbar, rowActions, emptyTitle = 'No results', emptyDescription = 'Try adjusting your search or filters.', className, }) {
    const [query, setQuery] = useState('');
    const [sortKey, setSortKey] = useState(null);
    const [sortDir, setSortDir] = useState('asc');
    const [page, setPage] = useState(0);
    const filtered = useMemo(() => {
        if (!query || !searchAccessor)
            return data;
        const q = query.toLowerCase();
        return data.filter((row) => searchAccessor(row).toLowerCase().includes(q));
    }, [data, query, searchAccessor]);
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
    const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
    const safePage = Math.min(page, pageCount - 1);
    const paged = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);
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
          {searchable && searchAccessor ? (<div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/>
              <Input value={query} onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                }} placeholder={searchPlaceholder} className="pl-9" aria-label="Search table"/>
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

        {paged.length === 0 && (<EmptyState title={emptyTitle} description={emptyDescription} className="rounded-none border-0 border-t"/>)}
      </div>

      {sorted.length > pageSize && (<div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
          <span className="tabular">
            {safePage * pageSize + 1}–
            {Math.min((safePage + 1) * pageSize, sorted.length)} of{' '}
            {sorted.length}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon-sm" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <span className="tabular text-xs">
              Page {safePage + 1} / {pageCount}
            </span>
            <Button variant="outline" size="icon-sm" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        </div>)}
    </div>);
}
