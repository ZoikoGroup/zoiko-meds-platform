import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
export const Accordion = AccordionPrimitive.Root;
export function AccordionItem({ className, ...props }) {
    return (<AccordionPrimitive.Item data-slot="accordion-item" className={cn('border-b border-border last:border-b-0', className)} {...props}/>);
}
export function AccordionTrigger({ className, children, ...props }) {
    return (<AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger data-slot="accordion-trigger" className={cn('flex flex-1 items-center justify-between gap-4 py-4 text-left text-sm font-medium transition-all outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring rounded-md [&[data-state=open]>svg]:rotate-180', className)} {...props}>
        {children}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200"/>
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>);
}
export function AccordionContent({ className, children, ...props }) {
    return (<AccordionPrimitive.Content data-slot="accordion-content" className="overflow-hidden text-sm text-muted-foreground data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down" {...props}>
      <div className={cn('pb-4 pt-0', className)}>{children}</div>
    </AccordionPrimitive.Content>);
}
