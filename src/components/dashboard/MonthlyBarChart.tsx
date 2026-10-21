import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { fetchSpendingByMonth, type MonthTotal } from '@/services/insightsService'
import { CURRENCY } from '@/lib/constants'

export function MonthlyBarChart() {
  const [data, setData] = useState<MonthTotal[]>([])

  useEffect(() => {
    fetchSpendingByMonth(6).then(setData)
  }, [])

  // Only show if there's at least one month with spending
  if (data.every((d) => d.total === 0)) return null

  return (
    <div className="bg-surface rounded-[var(--radius-lg)] p-5">
      <h3 className="font-bold text-sm mb-3">Monthly spending</h3>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data}>
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: '#929292' }}
          />
          <YAxis hide />
          <Tooltip
            formatter={(value: number) => `${CURRENCY.symbol}${value.toFixed(2)}`}
            labelFormatter={(label) => `${label}`}
          />
          <Bar
            dataKey="total"
            fill="#0B7A77"
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
