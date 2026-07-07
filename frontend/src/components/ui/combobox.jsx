import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
/** Accessible, searchable single-select used across all filter bars. */
export function Combobox({ options, value, onChange, placeholder = 'Select…', searchPlaceholder = 'Search…', emptyText = 'No results.', className, icon, ...aria }) {
    const [open, setOpen] = useState(false);
    const selected = options.find((o) => o.value === value);
    return (<Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} aria-label={aria['aria-label']} className={cn('h-9 justify-between gap-2 font-normal text-foreground', !selected && 'text-muted-foreground', className)}>
          <span className="flex items-center gap-2 truncate">
            {icon}
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50"/>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-52 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder}/>
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (<CommandItem key={option.value} value={option.label} onSelect={() => {
                onChange(option.value);
                setOpen(false);
            }}>
                  <Check className={cn('size-4', value === option.value ? 'opacity-100' : 'opacity-0')}/>
                  {option.label}
                </CommandItem>))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>);
}
