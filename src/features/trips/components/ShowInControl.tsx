import { formatAge, formatRate } from '../services/fxService'
import type { DisplayCurrencyState } from '../hooks/useDisplayCurrency'

/** "Show in" toggle between the trip currency and my own. Hidden when it would do nothing. */
export function ShowInControl({ tripCurrency, display }: { tripCurrency: string; display: DisplayCurrencyState }) {
  if (!display.available || display.rate === null) return null
  const btn = (on: boolean) =>
    `h-9 flex-1 rounded-[10px] text-[13px] ${on ? 'bg-surface font-extrabold text-text-primary shadow-sm' : 'font-bold text-gray-600'}`
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5">
        <span className="text-[13px] font-extrabold text-gray-700">Show in</span>
        <div role="group" aria-label="Currency to show" className="flex flex-1 rounded-[13px] bg-[#EDEDF0] p-1">
          <button type="button" aria-pressed={!display.mine} onClick={() => display.setMine(false)} className={btn(!display.mine)}>
            {tripCurrency} · trip
          </button>
          <button type="button" aria-pressed={display.mine} onClick={() => display.setMine(true)} className={btn(display.mine)}>
            {display.displayCurrency} · mine
          </button>
        </div>
      </div>
      {display.mine && (
        <p className="text-xs leading-relaxed text-text-muted">
          Approximate, at 1 {tripCurrency} = {formatRate(display.rate)} {display.displayCurrency} (updated{' '}
          {formatAge(display.ageHours)}). Balances and payments stay in {tripCurrency}.
        </p>
      )}
    </div>
  )
}
