'use client';

/**
 * Searchable single-select combobox.
 *
 * Built on Radix Popover (keyboard handling, focus management and dismiss
 * behaviour are already solved there) with a search field and a `listbox` of
 * options — the pattern used for picking a currency or a client contact, where a
 * native `<select>` would be unusable once the list is long.
 *
 * Accessibility:
 *  • the trigger is a `combobox` with `aria-expanded` / `aria-controls`,
 *  • options are `role="option"` inside `role="listbox"` with `aria-selected`,
 *  • ArrowUp/ArrowDown move the active option, Enter selects, Escape closes,
 *  • the search field is labelled and announces an empty result.
 */

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, ChevronsUpDown } from 'lucide-react';

import { classNames } from '@/lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Secondary text (e.g. currency name, contact email). */
  description?: string;
  /** Extra text matched by the search field. */
  keywords?: string;
}

interface ComboboxProps {
  options: readonly ComboboxOption[];
  value?: string | null;
  onChange: (value: string) => void;
  /** Called with the search text — lets the caller run a server-side search. */
  onSearchChange?: (query: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  loading?: boolean;
  id?: string;
  className?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export function Combobox({
  options,
  value,
  onChange,
  onSearchChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyMessage = 'No matches',
  disabled = false,
  loading = false,
  id,
  className,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listId = React.useId();

  const selected = options.find((option) => option.value === value) ?? null;

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      `${option.label} ${option.value} ${option.description ?? ''} ${option.keywords ?? ''}`
        .toLowerCase()
        .includes(needle)
    );
  }, [options, query]);

  // Resetting on close (rather than in an effect) keeps the popover from
  // re-rendering twice when it is dismissed.
  const close = React.useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  }, []);

  const commit = (option: ComboboxOption) => {
    onChange(option.value);
    close();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      const option = filtered[activeIndex];
      if (option) {
        event.preventDefault();
        commit(option);
      }
    } else if (event.key === 'Home') {
      setActiveIndex(0);
    } else if (event.key === 'End') {
      setActiveIndex(Math.max(filtered.length - 1, 0));
    }
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          disabled={disabled || loading}
          className={classNames(
            'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            invalid && 'border-destructive',
            className
          )}
        >
          <span className={classNames('truncate', !selected && 'text-muted-foreground')}>
            {loading ? 'Loading…' : selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[240px] rounded-md border border-input bg-background p-2 shadow-lg"
        >
          <input
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              onSearchChange?.(event.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            aria-controls={listId}
            autoFocus
            className="mb-2 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />

          <ul
            id={listId}
            role="listbox"
            aria-label={placeholder}
            className="max-h-64 overflow-y-auto"
          >
            {filtered.length === 0 && (
              <li className="px-2 py-3 text-sm text-muted-foreground" role="presentation">
                {emptyMessage}
              </li>
            )}
            {filtered.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <li key={option.value} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit(option)}
                    className={classNames(
                      'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                      index === activeIndex ? 'bg-muted' : 'bg-transparent',
                      isSelected && 'font-medium'
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{option.label}</span>
                      {option.description && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      )}
                    </span>
                    {isSelected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
