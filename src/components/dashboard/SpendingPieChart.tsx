import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { fetchMonthlySpending, type MonthlySpending } from '@/services/insightsService'
import { CURRENCY } from '@/lib/constants'

export function SpendingPieChart() {
  const [spending, setSpending] = useState<MonthlySpending | null>(null)

  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  useEffect(() => {
    fetchMonthlySpending(currentMonth).then(setSpending)
  }, [currentMonth])

  if (!spending || spending.byCategory.length === 0) return null

  const data = spending.byCategory.map(({ category, total }) => ({
    name: category.name,
    value: total,
    color: category.color,
  }))

  return (
    <div className="bg-surface rounded-[var(--radius-lg)] p-5">
      <h3 className="font-bold text-sm mb-3">Spending breakdown</h3>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            dataKey="value"
            paddingAngle={2}
          >
            {data.map((entry, index) => (
              <Cell key={index} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number) => `${CURRENCY.symbol}${value.toFixed(2)}`}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {data.map((entry) => (
          <div key={entry.name} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-xs text-text-secondary">{entry.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
