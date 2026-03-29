import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Sparkles, SkipForward } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { BUDGET_STRATEGIES } from '@/lib/constants'
import type { BudgetStrategy } from '@/types/models'

interface Question {
  id: string
  text: string
  options: { label: string; value: string }[]
}

const QUESTIONS: Question[] = [
  {
    id: 'tracking',
    text: 'How do you currently track your spending?',
    options: [
      { label: "I don't really track it", value: 'none' },
      { label: 'I check my bank app occasionally', value: 'casual' },
      { label: 'I use a spreadsheet or app', value: 'active' },
      { label: 'I have a detailed system', value: 'detailed' },
    ],
  },
  {
    id: 'goal',
    text: 'What matters most to you right now?',
    options: [
      { label: 'Just seeing where my money goes', value: 'visibility' },
      { label: 'Spending less in certain areas', value: 'reduce' },
      { label: 'Saving for something specific', value: 'save' },
      { label: 'Making every dollar count', value: 'optimize' },
    ],
  },
  {
    id: 'discipline',
    text: 'How strict do you want your budget to be?',
    options: [
      { label: 'Very flexible — just guide me', value: 'flexible' },
      { label: 'Some structure but room to breathe', value: 'moderate' },
      { label: 'Strict categories with hard limits', value: 'strict' },
      { label: 'Every dollar assigned to a purpose', value: 'zero' },
    ],
  },
  {
    id: 'income',
    text: 'How predictable is your income?',
    options: [
      { label: 'Same amount every month', value: 'stable' },
      { label: 'Mostly stable with some variation', value: 'mostly_stable' },
      { label: 'Varies a lot month to month', value: 'variable' },
      { label: 'Multiple income sources', value: 'multiple' },
    ],
  },
]

function recommendStrategy(answers: Map<string, string>): BudgetStrategy {
  const tracking = answers.get('tracking')
  const goal = answers.get('goal')
  const discipline = answers.get('discipline')

  // Zero-based: wants optimization + strict discipline
  if (discipline === 'zero' || (goal === 'optimize' && discipline === 'strict')) {
    return 'zero_based'
  }

  // Envelope: wants to reduce spending + moderate-to-strict
  if (goal === 'reduce' && (discipline === 'strict' || discipline === 'moderate')) {
    return 'envelope'
  }

  // Envelope: active tracker wanting more structure
  if ((tracking === 'active' || tracking === 'detailed') && discipline === 'strict') {
    return 'envelope'
  }

  // 50/30/20: wants savings + flexible-to-moderate
  if (goal === 'save' && (discipline === 'flexible' || discipline === 'moderate')) {
    return '50_30_20'
  }

  // 50/30/20: moderate discipline, stable income
  if (discipline === 'moderate') {
    return '50_30_20'
  }

  // Tracking only: just wants visibility, no tracking history, flexible
  if (goal === 'visibility' || tracking === 'none' || discipline === 'flexible') {
    return 'tracking_only'
  }

  // Default
  return '50_30_20'
}

type Step = 'questions' | 'recommendation' | 'confirmed'

export function StrategyWizard() {
  const navigate = useNavigate()
  const fetchProfile = useAuthStore((s) => s.fetchProfile)
  const [step, setStep] = useState<Step>('questions')
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<Map<string, string>>(new Map())
  const [recommended, setRecommended] = useState<BudgetStrategy | null>(null)
  const [selectedStrategy, setSelectedStrategy] = useState<BudgetStrategy | null>(null)
  const [saving, setSaving] = useState(false)

  const currentQuestion = QUESTIONS[questionIndex]!
  const totalQuestions = QUESTIONS.length

  const handleAnswer = (questionId: string, value: string) => {
    const next = new Map(answers)
    next.set(questionId, value)
    setAnswers(next)

    if (questionIndex < totalQuestions - 1) {
      setQuestionIndex(questionIndex + 1)
    } else {
      // All questions answered — generate recommendation
      const rec = recommendStrategy(next)
      setRecommended(rec)
      setSelectedStrategy(rec)
      setStep('recommendation')
    }
  }

  const handleConfirm = async () => {
    if (!selectedStrategy) return
    setSaving(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase
      .from('users')
      .update({
        budget_strategy: selectedStrategy,
        onboarding_completed: true,
      } as never)
      .eq('id', user.id)

    await fetchProfile()
    setStep('confirmed')
    setSaving(false)
  }

  const handleSkip = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase
      .from('users')
      .update({ onboarding_completed: true } as never)
      .eq('id', user.id)

    await fetchProfile()
    navigate('/')
  }

  // Step 1: Questions
  if (step === 'questions') {
    return (
      <div className="min-h-screen bg-background">
        <div className="bg-surface px-5 pt-12 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {questionIndex > 0 ? (
              <button onClick={() => setQuestionIndex(questionIndex - 1)} className="p-1">
                <ArrowLeft size={22} />
              </button>
            ) : (
              <button onClick={() => navigate(-1)} className="p-1">
                <ArrowLeft size={22} />
              </button>
            )}
            <h1 className="text-lg font-bold">Budget Strategy</h1>
          </div>
          <button onClick={handleSkip} className="flex items-center gap-1 text-sm text-text-secondary">
            <SkipForward size={16} />
            Skip
          </button>
        </div>

        <div className="px-5 pt-8">
          {/* Progress */}
          <div className="flex gap-1.5">
            {QUESTIONS.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full ${
                  i <= questionIndex ? 'bg-primary' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>

          <p className="text-xs text-text-secondary mt-4">
            Question {questionIndex + 1} of {totalQuestions}
          </p>

          <h2 className="text-xl font-bold mt-2">{currentQuestion.text}</h2>

          <div className="mt-6 space-y-3">
            {currentQuestion.options.map((option) => {
              const isSelected = answers.get(currentQuestion.id) === option.value
              return (
                <button
                  key={option.value}
                  onClick={() => handleAnswer(currentQuestion.id, option.value)}
                  className={`w-full text-left px-4 py-4 rounded-[var(--radius-md)] border transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary-tint text-primary'
                      : 'border-gray-200 bg-surface text-text-primary hover:border-gray-300'
                  }`}
                >
                  <span className="text-sm font-semibold">{option.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // Step 2: Recommendation
  if (step === 'recommendation') {
    const recStrategy = BUDGET_STRATEGIES.find((s) => s.id === recommended)!

    return (
      <div className="min-h-screen bg-background">
        <div className="bg-surface px-5 pt-12 pb-4 flex items-center gap-3">
          <button onClick={() => { setStep('questions'); setQuestionIndex(totalQuestions - 1) }} className="p-1">
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-lg font-bold">Your Recommendation</h1>
        </div>

        <div className="px-5 pt-8">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={20} className="text-primary" />
            <p className="text-sm text-primary font-semibold">Recommended for you</p>
          </div>

          <h2 className="text-2xl font-bold">{recStrategy.name}</h2>
          <p className="text-text-secondary mt-2">{recStrategy.description}</p>
          <p className="text-sm text-text-secondary mt-2">
            <strong>Best for:</strong> {recStrategy.bestFor}
          </p>

          {/* All strategies */}
          <div className="mt-8">
            <h3 className="font-bold text-sm text-text-secondary mb-3">Or choose a different approach</h3>
            <div className="space-y-3">
              {BUDGET_STRATEGIES.map((strategy) => {
                const isSelected = selectedStrategy === strategy.id
                const isRecommended = recommended === strategy.id

                return (
                  <button
                    key={strategy.id}
                    onClick={() => setSelectedStrategy(strategy.id)}
                    className={`w-full text-left px-4 py-4 rounded-[var(--radius-md)] border transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary-tint'
                        : 'border-gray-200 bg-surface hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-text-primary">{strategy.name}</span>
                      {isRecommended && (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary mt-1">{strategy.bestFor}</p>
                  </button>
                )
              })}
            </div>
          </div>

          <button
            onClick={handleConfirm}
            disabled={saving || !selectedStrategy}
            className="w-full mt-8 mb-8 bg-primary text-white font-semibold py-3.5 rounded-[var(--radius-xl)] hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {saving ? 'Saving...' : (
              <>Continue with this strategy <ArrowRight size={18} /></>
            )}
          </button>
        </div>
      </div>
    )
  }

  // Step 3: Confirmed
  const confirmedStrategy = BUDGET_STRATEGIES.find((s) => s.id === selectedStrategy)!

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-5">
      <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-6">
        <Sparkles size={32} className="text-primary" />
      </div>
      <h1 className="text-2xl font-bold text-center">You're all set!</h1>
      <p className="text-text-secondary text-center mt-2">
        Your strategy: <strong>{confirmedStrategy.name}</strong>
      </p>
      <p className="text-text-secondary text-center text-sm mt-1">
        You can change this anytime from your profile settings.
      </p>

      <div className="w-full mt-8 space-y-3">
        <button
          onClick={() => navigate('/budget/create')}
          className="w-full bg-primary text-white font-semibold py-3.5 rounded-[var(--radius-xl)] hover:bg-primary/90 transition-colors"
        >
          Set up your budget
        </button>
        <button
          onClick={() => navigate('/')}
          className="w-full bg-surface text-text-primary font-semibold py-3.5 rounded-[var(--radius-xl)] border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          Go to dashboard
        </button>
      </div>
    </div>
  )
}
