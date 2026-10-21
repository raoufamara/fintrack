import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { CurrencyPicker } from '../components/CurrencyPicker'
import { Screen, TopBar } from '../components/Screen'
import { DEFAULT_TRIP_CURRENCY, MAX_MEMBERS, validateNewTrip } from '../lib/validation'
import { useTripsStore } from '../store/TripsContext'

export function NewTripPage() {
  const navigate = useNavigate()
  const createTrip = useTripsStore((s) => s.createTrip)
  const [name, setName] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [currency, setCurrency] = useState(DEFAULT_TRIP_CURRENCY)
  const [budget, setBudget] = useState('')
  const [members, setMembers] = useState<string[]>([])
  const [memberInput, setMemberInput] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  const { errors, budgetAmount } = validateNewTrip({ name, start, end, budget, currency })
  const show = submitted ? errors : {}

  const addMember = () => {
    const n = memberInput.trim()
    if (!n || members.length >= MAX_MEMBERS) return
    if (!members.some((m) => m.toLowerCase() === n.toLowerCase())) setMembers([...members, n])
    setMemberInput('')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length > 0 || saving) return
    setSaving(true)
    const pending = memberInput.trim()
    const id = await createTrip({
      name: name.trim(),
      defaultCurrency: currency,
      startDate: start || null,
      endDate: end || null,
      budgetAmount,
      memberNames: pending && !members.includes(pending) ? [...members, pending] : members,
    })
    setSaving(false)
    if (id) navigate(`/trips/${id}`, { replace: true })
  }

  const inputClass =
    'h-12 w-full min-w-0 rounded-[12px] border border-gray-300 bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-2 focus:border-primary focus:px-[13px]'

  return (
    <Screen>
      <TopBar title="New trip" close onBack={() => navigate('/trips')} />
      <form onSubmit={submit} noValidate className="flex flex-1 flex-col">
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="trip-name" className="text-[13px] font-extrabold text-gray-700">Trip name</label>
            <input
              id="trip-name"
              className={inputClass}
              value={name}
              maxLength={80}
              placeholder="Morocco with friends"
              aria-invalid={!!show.name}
              onChange={(e) => setName(e.target.value)}
            />
            {show.name && <span role="alert" className="text-xs font-bold text-error">{show.name}</span>}
          </div>

          <div className="flex gap-2.5">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[13px] font-extrabold text-gray-700">Starts</span>
              <input className={inputClass} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[13px] font-extrabold text-gray-700">Ends</span>
              <input className={inputClass} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          {show.dates && <span role="alert" className="-mt-2 text-xs font-bold text-error">{show.dates}</span>}

          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-extrabold text-gray-700">Default currency</span>
            <CurrencyPicker value={currency} onChange={setCurrency} />
            <span className="text-xs leading-relaxed text-text-muted">
              Totals and balances are shown in this currency. You can still add expenses in any currency.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="trip-budget" className="text-[13px] font-extrabold text-gray-700">
              Budget <span className="font-semibold text-text-muted">optional</span>
            </label>
            <input
              id="trip-budget"
              className={inputClass}
              inputMode="decimal"
              value={budget}
              placeholder="0.00"
              aria-invalid={!!show.budget}
              onChange={(e) => setBudget(e.target.value)}
            />
            {show.budget && <span role="alert" className="text-xs font-bold text-error">{show.budget}</span>}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-extrabold text-gray-700">People</span>
            <ul className="flex flex-wrap gap-2" aria-label="People on this trip">
              <li className="flex h-9 items-center rounded-full border border-gray-300 bg-surface px-3.5 text-[13px] font-bold">
                You
              </li>
              {members.map((m) => (
                <li
                  key={m}
                  className="flex h-9 items-center gap-1 rounded-full border border-gray-300 bg-surface pl-3.5 pr-1 text-[13px] font-bold"
                >
                  {m}
                  <button
                    type="button"
                    aria-label={`Remove ${m}`}
                    onClick={() => setMembers(members.filter((x) => x !== m))}
                    className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-black/5"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                className={inputClass}
                value={memberInput}
                maxLength={40}
                placeholder="Add a name"
                aria-label="Add a person"
                onChange={(e) => setMemberInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addMember()
                  }
                }}
              />
              <button
                type="button"
                onClick={addMember}
                className="h-11 shrink-0 rounded-full border border-gray-300 bg-surface px-4 text-sm font-bold"
              >
                Add
              </button>
            </div>
            <span className="text-xs leading-relaxed text-text-muted">
              Friends don’t need an account. They can claim their name later from the invite link.
            </span>
          </div>
        </div>

        <div className="sticky bottom-0 mt-auto border-t border-gray-100 bg-background px-4 pb-5 pt-3">
          <button
            type="submit"
            disabled={saving}
            className="h-14 w-full rounded-full bg-primary text-base font-bold text-white disabled:bg-[#B5CFCC]"
          >
            {saving ? 'Creating…' : 'Create trip'}
          </button>
        </div>
      </form>
    </Screen>
  )
}
