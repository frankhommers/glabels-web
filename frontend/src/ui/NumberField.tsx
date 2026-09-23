/** Number field with a unit, in the same shape as the rest of the forms. */

export function NumberField({
  label,
  value,
  onChange,
  suffix,
  step = 0.1,
  min,
  max,
  disabled,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  suffix?: string
  step?: number
  min?: number
  max?: number
  disabled?: boolean
}) {
  return (
    <div className="form-row">
      <label>{label}</label>
      <span className="spin">
        <input
          type="number"
          value={Number.isFinite(value) ? Number(value.toFixed(4)) : 0}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(event) => {
            const next = Number.parseFloat(event.target.value)
            if (Number.isFinite(next)) onChange(next)
          }}
        />
        {suffix ? <span className="spin-suffix">{suffix}</span> : null}
      </span>
    </div>
  )
}
