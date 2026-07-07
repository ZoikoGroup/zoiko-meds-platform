import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, } from '@/components/ui/card';
import { cn } from '@/lib/utils';
/** Consistent titled surface for every visualization, with an entrance fade. */
export function ChartCard({ title, description, action, children, className, contentClassName, index = 0, }) {
    return (<motion.div initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.45, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }} className={cn('h-full', className)}>
      <Card className="h-full">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="flex flex-col gap-1">
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </CardHeader>
        <CardContent className={cn('pt-2', contentClassName)}>
          {children}
        </CardContent>
      </Card>
    </motion.div>);
}
