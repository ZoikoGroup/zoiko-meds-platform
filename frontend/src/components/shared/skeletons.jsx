import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
export function KpiCardSkeleton() {
    return (<Card className="gap-4 p-5">
      <div className="flex items-center justify-between">
        <Skeleton className="size-9 rounded-xl"/>
        <Skeleton className="h-5 w-20 rounded-full"/>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-28"/>
        <Skeleton className="h-7 w-24"/>
      </div>
      <Skeleton className="h-10 w-full"/>
    </Card>);
}
export function ChartCardSkeleton({ height = 260 }) {
    return (<Card className="h-full">
      <CardHeader className="space-y-2">
        <Skeleton className="h-4 w-40"/>
        <Skeleton className="h-3 w-56"/>
      </CardHeader>
      <CardContent>
        <Skeleton className="w-full rounded-lg" style={{ height }}/>
      </CardContent>
    </Card>);
}
export function StatTileSkeleton() {
    return (<Card className="gap-3 p-5">
      <Skeleton className="h-3.5 w-24"/>
      <Skeleton className="h-7 w-20"/>
    </Card>);
}
export function TableSkeleton({ rows = 6 }) {
    return (<Card>
      <CardContent className="space-y-3 py-5">
        <Skeleton className="h-8 w-full"/>
        {Array.from({ length: rows }).map((_, i) => (<Skeleton key={i} className="h-10 w-full"/>))}
      </CardContent>
    </Card>);
}
