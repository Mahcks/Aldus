import type { RequestStatusFilterProps } from './RequestStatusFilter';

export function RequestStatusFilter({ label, options, value, onChange }: RequestStatusFilterProps) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-11 w-full cursor-pointer rounded-control border border-line-strong bg-panel px-3 py-2 text-base font-sans-medium text-ink hover:bg-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
