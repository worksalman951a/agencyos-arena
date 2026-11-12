'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
  type InputHTMLAttributes,
} from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import './primitives.css';

/* ============================================================================
   Premium primitives
   ----------------------------------------------------------------------------
   The patterns that were copy-pasted across Contacts, Projects and Invoices,
   extracted once. Every screen from here on composes these instead of writing
   its own toolbar, status dot, table mark-up, stat tile or empty state.

   Rules this layer keeps:
   • theme-aware through the --pm-* tokens only (no hardcoded colour)
   • container-query aware (the prototype renders inside fixed-size frames, so
     viewport media queries never fire — see PREMIUM-DESIGN-SYSTEM.md §8)
   • every control has hover, focus-visible, disabled and — where it applies —
     invalid states, and no state is signalled by colour alone
   • nothing is an <a> that does not navigate and nothing is a <button> that
     does nothing: handlers are required where an action is implied
   ========================================================================== */

/* ── Money & numbers ────────────────────────────────────────────────────── */

export const MONEY = (n: number, opts: { cents?: boolean } = {}) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: opts.cents === false ? 0 : 2,
    maximumFractionDigits: opts.cents === false ? 0 : 2,
  });

/** 184300 → "$184.3k". Used where a full figure would break the layout. */
export const shortMoney = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${n < 0 ? '−' : ''}$${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${n < 0 ? '−' : ''}$${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  return MONEY(n, { cents: false });
};

export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;

/* ── Toolbar ────────────────────────────────────────────────────────────── */

export function Toolbar({
  search,
  children,
  count,
}: {
  search?: ReactNode;
  children?: ReactNode;
  count?: ReactNode;
}) {
  return (
    <div className="pmx-toolbar">
      {search}
      {children}
      {count !== undefined && <span className="pmx-toolbar__count">{count}</span>}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <label className="pmx-search">
      <Search size={14} strokeWidth={1.9} aria-hidden />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
      {value && (
        <button
          type="button"
          className="pmx-search__clear"
          onClick={() => onChange('')}
          aria-label="Clear search"
        >
          <X size={12} strokeWidth={2.4} />
        </button>
      )}
    </label>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="pmx-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          data-on={value === o.value || undefined}
          aria-pressed={value === o.value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A labelled <select> that reads as chrome, not as a form field. */
export function SelectField({
  value,
  onChange,
  options,
  label,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  label: string;
  id?: string;
}) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <div className="pmx-select">
      <select
        id={selectId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} strokeWidth={2.2} aria-hidden />
    </div>
  );
}

/* ── Status ─────────────────────────────────────────────────────────────── */

export type PmTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'idle' | 'accent' | 'info';

/** Dot + word. Never colour alone: the label is always present. */
export function StatusPill({ tone = 'neutral', children }: { tone?: PmTone; children: ReactNode }) {
  return (
    <span className="pmx-status" data-tone={tone}>
      <i aria-hidden />
      {children}
    </span>
  );
}

export function Chip({ tone, children }: { tone?: PmTone; children: ReactNode }) {
  return (
    <span className="pm-chip" data-tone={tone}>
      {children}
    </span>
  );
}

/** Initials avatar. `tone="accent"` marks the record's primary person. */
export function Avatar({
  name,
  size = 'md',
  tone,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'accent';
}) {
  /* Dots are stripped rather than used to drop the part: filtering out dotted
     parts turned "Salman R." into a lone "S" while "Priya Raman" kept two
     letters, so avatars disagreed about how many initials a person has. */
  const initials = useMemo(
    () =>
      name
        .split(/\s+/)
        .map((p) => p.replace(/\./g, ''))
        .filter((p) => p.length > 0)
        .slice(0, 2)
        .map((p) => p[0])
        .join('')
        .toUpperCase(),
    [name]
  );
  return (
    <span className="pmx-av" data-size={size} data-tone={tone} aria-hidden>
      {initials}
    </span>
  );
}

/* ── Stat tiles ─────────────────────────────────────────────────────────── */

export type Stat = {
  label: string;
  value: string;
  note?: ReactNode;
  tone?: 'warn' | 'danger' | 'ok';
  /** Optional sparkline-ish progress 0–1, drawn under the numeral. */
  meter?: number;
};

export function StatStrip({ stats, cols }: { stats: Stat[]; cols?: 2 | 3 | 4 | 5 }) {
  return (
    <div className="pmx-stats" data-cols={cols ?? Math.min(stats.length, 4)}>
      {stats.map((s) => (
        <section className="pm-tile pmx-stat" key={s.label}>
          <span className="pm-overline">{s.label}</span>
          <span className="pmx-stat__num" data-tone={s.tone}>
            {s.value}
          </span>
          {s.meter !== undefined && (
            <span className="pmx-stat__meter" aria-hidden>
              <i
                style={{ width: `${Math.max(0, Math.min(1, s.meter)) * 100}%` }}
                data-tone={s.tone}
              />
            </span>
          )}
          {s.note && (
            <span className="pmx-stat__note" data-tone={s.tone}>
              {s.note}
            </span>
          )}
        </section>
      ))}
    </div>
  );
}

/* ── Progress ───────────────────────────────────────────────────────────── */

export function Meter({
  value,
  marker,
  tone,
  label,
}: {
  /** Fill, 0–1. */
  value: number;
  /** Optional second marker, 0–1 — e.g. elapsed time against budget burn. */
  marker?: number;
  tone?: 'warn' | 'danger' | 'ok';
  label: string;
}) {
  return (
    <span className="pmx-meter" role="img" aria-label={label}>
      <i
        className="pmx-meter__fill"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        data-tone={tone}
      />
      {marker !== undefined && (
        <i
          className="pmx-meter__marker"
          style={{ left: `${Math.max(0, Math.min(1, marker)) * 100}%` }}
        />
      )}
    </span>
  );
}

/* ── Empty & zero states ────────────────────────────────────────────────── */

export function EmptyState({
  title,
  sub,
  action,
  block,
  icon,
}: {
  title: string;
  sub?: string;
  action?: { label: string; onClick: () => void };
  block?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className={block ? 'pmx-empty pmx-empty--block' : 'pmx-empty'} role="status">
      {icon && <span className="pmx-empty__icon">{icon}</span>}
      <span className="pmx-empty__title">{title}</span>
      {sub && <span className="pmx-empty__sub">{sub}</span>}
      {action && (
        <button type="button" className="pm-btn pm-btn--quiet pm-btn--sm" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/* ── Callout ────────────────────────────────────────────────────────────── */

export function Callout({
  tone = 'neutral',
  title,
  children,
  action,
}: {
  tone?: 'neutral' | 'warn' | 'danger' | 'ok';
  title: string;
  children?: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="pmx-callout" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className="pmx-callout__body">
        <span className="pmx-callout__title">{title}</span>
        {children && <span className="pmx-callout__text">{children}</span>}
      </div>
      {action && (
        <button type="button" className="pm-btn pm-btn--quiet pm-btn--sm" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/* ── Tabs ───────────────────────────────────────────────────────────────── */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="pmx-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          data-on={value === t.value || undefined}
          onClick={() => onChange(t.value)}
        >
          {t.label}
          {t.count !== undefined && <span className="pmx-tabs__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── Data table ─────────────────────────────────────────────────────────────
   Declarative columns, because the phone transformation must be data. The old
   screens selected `:nth-child(4)` and `:nth-child(7)` in CSS, so inserting a
   column silently broke the phone layout.

   `mobile` names the grid area a column occupies under 720px:
     'title' | 'meta' | 'value' | 'status' | 'actions' | 'hide'
   -------------------------------------------------------------------------- */

export type Column<T> = {
  key: string;
  header: ReactNode;
  /** Cell renderer. `row` is typed, so no casts at the call site. */
  cell: (row: T, index: number) => ReactNode;
  /** 'num' right-aligns and applies tabular figures. */
  align?: 'left' | 'right';
  width?: string;
  mobile?: 'title' | 'meta' | 'value' | 'status' | 'actions' | 'hide';
  /** Hidden below 1180px container — for the first column to go on a tablet. */
  dropAt?: 1180 | 1080;
};

export function DataTable<T>({
  columns,
  rows,
  getKey,
  label,
  onRowClick,
  activeKey,
  pickedKeys,
  onPick,
  onPickAll,
  foot,
  empty,
  selectionLabel = 'Select row',
}: {
  columns: Array<Column<T>>;
  rows: T[];
  getKey: (row: T) => string;
  label: string;
  onRowClick?: (row: T) => void;
  activeKey?: string;
  pickedKeys?: string[];
  onPick?: (key: string) => void;
  onPickAll?: () => void;
  foot?: ReactNode;
  empty?: ReactNode;
  selectionLabel?: string;
}) {
  const grid: Record<string, string> = {};
  columns.forEach((c, i) => {
    grid[`--c${i + 1}`] = c.width ?? 'minmax(0, 1fr)';
  });

  /* The selection column is part of the grid, not an extra child. Without its
     own track the header row and every body row shift by one column — the
     first version of this table did exactly that. */
  const template = [...(onPick ? ['18px'] : []), ...columns.map((_, i) => `var(--c${i + 1})`)].join(
    ' '
  );
  const style = { ...grid, gridTemplateColumns: template } as React.CSSProperties;

  const allPicked =
    pickedKeys !== undefined && rows.length > 0 && pickedKeys.length === rows.length;

  return (
    <div className="pmx-table-scroll">
      <div className="pmx-table" role="table" aria-label={label}>
        <div className="pmx-table__head" role="row" style={style}>
          {onPick && (
            <span role="columnheader" className="pmx-check">
              <input
                type="checkbox"
                checked={allPicked}
                onChange={onPickAll}
                aria-label="Select all rows"
              />
            </span>
          )}
          {columns.map((c) => (
            <span
              key={c.key}
              role="columnheader"
              className={c.align === 'right' ? 'pmx-r' : undefined}
              data-drop={c.dropAt}
              data-mobile={c.mobile}
            >
              {c.header}
            </span>
          ))}
        </div>

        {rows.map((row, ri) => {
          const key = getKey(row);
          const picked = pickedKeys?.includes(key);
          const active = activeKey === key;
          const cells = columns.map((c) => (
            <span
              key={c.key}
              role="cell"
              className="pmx-cell"
              data-align={c.align}
              data-drop={c.dropAt}
              data-mobile={c.mobile}
            >
              {c.cell(row, ri)}
            </span>
          ));

          return onRowClick ? (
            <div
              key={key}
              role="row"
              className="pmx-table__row"
              data-active={active || undefined}
              data-picked={picked || undefined}
              data-clickable
              style={style}
              tabIndex={0}
              onClick={() => onRowClick(row)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onRowClick(row);
                }
              }}
              aria-current={active ? 'true' : undefined}
            >
              {onPick && (
                <span role="cell" className="pmx-check" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={!!picked}
                    onChange={() => onPick(key)}
                    aria-label={`${selectionLabel} ${key}`}
                  />
                </span>
              )}
              {cells}
            </div>
          ) : (
            <div
              key={key}
              role="row"
              className="pmx-table__row"
              data-picked={picked || undefined}
              style={style}
            >
              {onPick && (
                <span role="cell" className="pmx-check">
                  <input
                    type="checkbox"
                    checked={!!picked}
                    onChange={() => onPick(key)}
                    aria-label={`${selectionLabel} ${key}`}
                  />
                </span>
              )}
              {cells}
            </div>
          );
        })}

        {rows.length === 0 && (
          <div className="pmx-table__none">
            {empty ?? <EmptyState title="No rows" sub="Adjust the filters." />}
          </div>
        )}
      </div>
      {foot && <div className="pmx-tablefoot">{foot}</div>}
    </div>
  );
}

/* ── Record header (detail pages) ───────────────────────────────────────── */

export function RecordHeader({
  mark,
  title,
  sub,
  chips,
  meta,
  actions,
}: {
  mark?: ReactNode;
  title: string;
  sub?: ReactNode;
  chips?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="pmx-rhead">
      {mark && <span className="pmx-rhead__mark">{mark}</span>}
      <div className="pmx-rhead__id">
        <div className="pmx-rhead__titlerow">
          <h2 className="pmx-rhead__name">{title}</h2>
          {chips && <span className="pmx-rhead__chips">{chips}</span>}
        </div>
        {sub && <span className="pmx-rhead__sub">{sub}</span>}
        {meta && <span className="pmx-rhead__meta">{meta}</span>}
      </div>
      {actions && <div className="pmx-rhead__acts">{actions}</div>}
    </div>
  );
}

/* ── Definition list ────────────────────────────────────────────────────── */

export function Facts({ rows, cols = 2 }: { rows: Array<[string, ReactNode]>; cols?: 1 | 2 }) {
  return (
    <dl className="pmx-facts" data-cols={cols}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── Timeline ───────────────────────────────────────────────────────────── */

export function Timeline({
  items,
}: {
  items: Array<{ when: string; who?: string; title: string; body?: string; tone?: PmTone }>;
}) {
  return (
    <ol className="pmx-timeline">
      {items.map((it, i) => (
        <li key={`${it.title}-${i}`} data-tone={it.tone}>
          <span className="pmx-timeline__dot" aria-hidden />
          <div className="pmx-timeline__body">
            <span className="pmx-timeline__title">{it.title}</span>
            {it.body && <span className="pmx-timeline__text">{it.body}</span>}
            <span className="pmx-timeline__when">
              {it.when}
              {it.who ? ` · ${it.who}` : ''}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ── Form controls ──────────────────────────────────────────────────────────
   A real form needs a label, a hint, an error and a required marker — the
   prototype previously had none of those, so validation was invisible.
   -------------------------------------------------------------------------- */

export function FormRow({
  label,
  hint,
  error,
  htmlFor,
  required,
  children,
  wide,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="pmx-field"
      data-wide={wide || undefined}
      data-invalid={error ? true : undefined}
    >
      <label className="pmx-field__label" htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="pmx-field__req" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <span className="pmx-field__error" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="pmx-field__hint">{hint}</span>
      )}
    </div>
  );
}

export function TextInput({
  id,
  invalid,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { id?: string; invalid?: boolean }) {
  return <input id={id} className="pmx-input" data-invalid={invalid || undefined} {...rest} />;
}

export function TextArea({
  id,
  invalid,
  rows = 3,
  ...rest
}: InputHTMLAttributes<HTMLTextAreaElement> & { id?: string; invalid?: boolean; rows?: number }) {
  return (
    <textarea
      id={id}
      className="pmx-input pmx-input--area"
      data-invalid={invalid || undefined}
      rows={rows}
      {...rest}
    />
  );
}

export function FieldSelect({
  id,
  value,
  onChange,
  options,
}: {
  id?: string;
  value: string;
  onChange?: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="pmx-select pmx-select--field">
      <select id={id} value={value} onChange={(e) => onChange?.(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronDown size={12} strokeWidth={2.2} aria-hidden />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="pmx-switch"
      data-on={checked || undefined}
      onClick={() => onChange(!checked)}
    >
      <span className="pmx-switch__knob" aria-hidden />
    </button>
  );
}

/* ── Local UI state, without a state library ────────────────────────────── */

/** Selection set with the usual toggle / all / none behaviour. */
export function useSelection(keys: string[]) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = useCallback(
    (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k])),
    []
  );
  const all = useCallback(
    () => setPicked(picked.length === keys.length ? [] : keys),
    [keys, picked.length]
  );
  const clear = useCallback(() => setPicked([]), []);
  return { picked, toggle, all, clear, count: picked.length };
}

/** Close on Escape — used by panels and drawers. */
export function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onClose]);
}

/* ── Section wrapper for detail pages ───────────────────────────────────── */

export function Panel({
  title,
  action,
  children,
  pad,
  className,
  meta,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  /** Content manages its own padding (tables, lists). */
  pad?: boolean;
  className?: string;
  /** Secondary line under the title — a period, a count, a constraint. */
  meta?: string;
}) {
  return (
    <section className={className ? `pm-tile pmx-panel ${className}` : 'pm-tile pmx-panel'}>
      {(title || action) && (
        <header className="pmx-panel__head">
          <div className="pmx-panel__heading">
            {title && <h3 className="pmx-panel__title">{title}</h3>}
            {meta && <span className="pmx-panel__meta">{meta}</span>}
          </div>
          {action && <div className="pmx-panel__act">{action}</div>}
        </header>
      )}
      <div className={pad ? 'pmx-panel__body pmx-panel__body--flush' : 'pmx-panel__body'}>
        {children}
      </div>
    </section>
  );
}

export function KeyValueRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: 'warn' | 'danger' | 'ok';
}) {
  return (
    <div className="pmx-kv">
      <span className="pmx-kv__k">{label}</span>
      <span className="pmx-kv__v" data-tone={tone}>
        {value}
      </span>
    </div>
  );
}
