import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'

// One value out of a short list, in the product's own control rather than the
// browser's.
//
// The native one is a different widget on every platform: it cannot be styled
// to sit with the fields beside it, and on a phone it opens the operating
// system's own wheel. These screens are dense enough that a control which
// does not match the ones next to it reads as a different kind of thing.
//
// A thin wrapper because the parts underneath are six elements per field, and
// six of those in one form is where the form disappears.
export function Choice({
  id,
  value,
  options,
  placeholder,
  disabled,
  className,
  onChange,
}: {
  id?: string
  /** empty means nothing is chosen yet, which is what the placeholder is for */
  value: string
  options: readonly { value: string; label: string }[]
  placeholder?: string
  disabled?: boolean
  className?: string
  onChange: (value: string) => void
}) {
  return (
    <Select value={value === '' ? undefined : value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
