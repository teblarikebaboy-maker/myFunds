import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  chooseDatabaseDirectory,
  createPasswordHash,
  loadSavedDirectory,
  loadSavedMembers,
  readWorkbookData,
  saveDirectory,
  saveMembersLocally,
  supportsDatabaseFolder,
  verifyPassword,
  writeWorkbookData,
  type AccountRole,
  type Borrower,
  type DatabaseAccount,
  type DatabaseDirectoryHandle,
  type Member,
} from './database'
import './App.css'

type TabKey = 'overview' | 'savings' | 'loans' | 'profits' | 'data'
type ChartStyle = 'bar' | 'line'
const getMemberSavings = (member: Member) =>
  member.initialSavings
  + member.contributions.reduce((total, contribution) => total + contribution.amount, 0)
  - member.withdrawals.reduce((total, withdrawal) => total + withdrawal.amount, 0)

const syncAccountMembers = (accounts: DatabaseAccount[], currentMembers: Member[]) => {
  const members = currentMembers.map((member) => ({ ...member }))

  accounts.forEach((account) => {
    const normalizedEmail = account.email.trim().toLowerCase()
    const linkedMember = members.find((member) => member.accountEmail?.toLowerCase() === normalizedEmail)
    if (linkedMember) return

    const existingMember = members.find((member) =>
      !member.accountEmail && member.name.trim().toLowerCase() === account.name.trim().toLowerCase(),
    )
    if (existingMember) {
      existingMember.accountEmail = normalizedEmail
      return
    }

    const baseName = account.name.trim() || account.email
    const hasName = (name: string) => members.some((member) => member.name.toLowerCase() === name.toLowerCase())
    let memberName = baseName
    if (hasName(memberName)) memberName = `${baseName} (${account.email})`
    let suffix = 2
    while (hasName(memberName)) {
      memberName = `${baseName} (${account.email}, ${suffix})`
      suffix += 1
    }

    members.push({
      name: memberName,
      accountEmail: normalizedEmail,
      initialSavings: 0,
      initialSavingsDate: getLocalDate(),
      contributions: [],
      withdrawals: [],
    })
  })

  const registeredEmails = new Set(accounts.map((account) => account.email.trim().toLowerCase()))
  return members.filter((member) =>
    member.accountEmail !== undefined && registeredEmails.has(member.accountEmail.trim().toLowerCase()),
  )
}

const summaryCards = [
  { label: 'Available funds', value: '₱32,480', delta: '+₱1,240', tone: 'positive' },
  { label: 'Total Savings', value: '₱8,420', delta: '+8.4%', tone: 'positive' },
  { label: 'Loans Proceeds', value: '₱5,420', delta: '-3.1%', tone: 'negative' },
  { label: 'Total Profits', value: '36%', delta: '+4.6 pts', tone: 'positive' },
]

const spendingTrend = [
  { month: 'Jan', value: 3600 },
  { month: 'Feb', value: 4800 },
  { month: 'Mar', value: 4200 },
  { month: 'Apr', value: 6100 },
  { month: 'May', value: 5800 },
  { month: 'Jun', value: 7300 },
  { month: 'Jul', value: 6700 },
  { month: 'Aug', value: 7800 },
  { month: 'Sep', value: 6400 },
  { month: 'Oct', value: 8200 },
  { month: 'Nov', value: 7500 },
  { month: 'Dec', value: 9100 },
]

const budgetCategories = [
  { name: 'Housing', spent: 1480, limit: 1800, color: 'teal' },
  { name: 'Food', spent: 760, limit: 900, color: 'blue' },
  { name: 'Transport', spent: 420, limit: 600, color: 'orange' },
  { name: 'Entertainment', spent: 390, limit: 500, color: 'pink' },
]

const transactions = [
  { merchant: 'Northwind Payroll', type: 'Income', amount: '+₱2,950', date: 'Today', tone: 'positive' },
  { merchant: 'Fresh Market', type: 'Groceries', amount: '-₱148', date: 'Yesterday', tone: 'negative' },
  { merchant: 'City Transport', type: 'Transit', amount: '-₱64', date: 'Mon', tone: 'negative' },
  { merchant: 'Apex Studio', type: 'Subscription', amount: '-₱29', date: 'Sun', tone: 'negative' },
]

const upcomingBills = [
  { name: 'Rent', due: 'Due in 3 days', amount: '₱1,520' },
  { name: 'Utilities', due: 'Due in 6 days', amount: '₱210' },
  { name: 'Insurance', due: 'Due in 11 days', amount: '₱180' },
]

const goals = [
  { name: 'Emergency fund', value: '₱8,200', target: '₱10,000', progress: 82 },
  { name: 'Vacation', value: '₱2,640', target: '₱5,000', progress: 53 },
]

const homeDownPaymentTarget = 30000

const savingsPlans = [
  { name: 'Home down payment', value: '₱15,600', target: '₱30,000', rate: 52 },
]

const loanOverview = [
  { name: 'Mortgage', balance: '₱184,500', rate: '4.2%', payment: '₱1,280' },
  { name: 'Car loan', balance: '₱12,400', rate: '3.6%', payment: '₱410' },
  { name: 'Student loan', balance: '₱8,200', rate: '2.9%', payment: '₱220' },
]

const profitsData = [
  { label: 'Net profit', value: '₱11,240', tone: 'positive' },
  { label: 'YTD margin', value: '23.8%', tone: 'positive' },
  { label: 'Capital gains', value: '₱2,960', tone: 'positive' },
  { label: 'Operating costs', value: '₱7,540', tone: 'negative' },
]

const dataBreakdown = [
  { label: 'Housing', value: '29%' },
  { label: 'Food', value: '18%' },
  { label: 'Transport', value: '11%' },
  { label: 'Investments', value: '24%' },
  { label: 'Other', value: '18%' },
]

const tabs: Array<{ id: TabKey; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'savings', label: 'Savings' },
  { id: 'loans', label: 'Loans' },
  { id: 'profits', label: 'Profits' },
  { id: 'data', label: 'Data' },
]

const chartStyles: Array<{ value: ChartStyle; label: string }> = [
  { value: 'bar', label: 'Bars' },
  { value: 'line', label: 'Line' },
]

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(amount)

const getLocalDate = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}

const formatDate = (date: string) =>
  new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
    .format(new Date(`${date}T00:00:00`))

const currentYear = new Date().getFullYear()

function OverviewPage({ totalSavings }: { totalSavings: number }) {
  const [chartStyle, setChartStyle] = useState<ChartStyle>('bar')
  const [isChartStyleMenuOpen, setIsChartStyleMenuOpen] = useState(false)
  const currentBudget = budgetCategories.reduce((sum, item) => sum + item.spent, 0)
  const totalCapacity = budgetCategories.reduce((sum, item) => sum + item.limit, 0)
  const budgetUsage = Math.round((currentBudget / totalCapacity) * 100)
  const maxMonthlyProfit = Math.max(...spendingTrend.map((bar) => bar.value))
  const chartPoints = spendingTrend.map((bar, index) => ({
    x: 20 + (index / (spendingTrend.length - 1)) * 1060,
    y: 90 - (bar.value / maxMonthlyProfit) * 76,
  }))
  const chartPath = chartPoints.slice(1).reduce((path, point) => {
    return `${path} L ${point.x} ${point.y}`
  }, `M ${chartPoints[0].x} ${chartPoints[0].y}`)
  const selectedChartStyle = chartStyles.find((style) => style.value === chartStyle)!

  return (
    <main className="dashboard">
      <section className="summary-grid" aria-label="Summary cards">
        {summaryCards.map((card) => (
          <article key={card.label} className="summary-card">
            <p>{card.label}</p>
            <h2>{card.label === 'Total Savings' ? formatCurrency(totalSavings) : card.value}</h2>
            <span className={card.tone}>{card.delta}</span>
          </article>
        ))}
      </section>

      <section className="content-grid">
        <article className="panel chart-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">PROFIT</p>
              <h3>Monthly Profit</h3>
            </div>
            <button type="button" className="secondary-button">{currentYear}</button>
          </div>

          <div className={`chart chart-${chartStyle}`} aria-label="Monthly profit trend">
            {chartStyle === 'bar' ? (
              spendingTrend.map((bar) => (
                <div key={bar.month} className="bar-group">
                  <div
                    className="bar-track"
                    role="img"
                    aria-label={`${bar.month}: ${formatCurrency(bar.value)} profit`}
                    tabIndex={0}
                  >
                    <div
                      className="bar-fill"
                      data-value={formatCurrency(bar.value)}
                      style={{ height: `${(bar.value / maxMonthlyProfit) * 100}%` }}
                    />
                  </div>
                  <span>{bar.month}</span>
                </div>
              ))
            ) : (
              <>
                <div className="chart-plot">
                  <svg className="chart-line-svg" viewBox="0 0 1100 100" preserveAspectRatio="none" aria-hidden="true">
                    <path className="chart-line-path" d={chartPath} />
                    {chartPoints.map((point, index) => (
                      <circle key={spendingTrend[index].month} className="chart-line-dot" cx={point.x} cy={point.y} r="5" />
                    ))}
                  </svg>
                  {spendingTrend.map((bar, index) => (
                    <div
                      key={bar.month}
                      className="chart-point"
                      role="img"
                      aria-label={`${bar.month}: ${formatCurrency(bar.value)} profit`}
                      data-value={formatCurrency(bar.value)}
                      style={{
                        left: `${(index / (spendingTrend.length - 1)) * 100}%`,
                        bottom: `${5 + (bar.value / maxMonthlyProfit) * 80}%`,
                      }}
                      tabIndex={0}
                    />
                  ))}
                </div>
                <div className="chart-months" aria-hidden="true">
                  {spendingTrend.map((bar) => <span key={bar.month}>{bar.month}</span>)}
                </div>
              </>
            )}
          </div>

          <div
            className="chart-style-control"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setIsChartStyleMenuOpen(false)
            }}
          >
            <button
              type="button"
              className="chart-style-button"
              aria-haspopup="true"
              aria-expanded={isChartStyleMenuOpen}
              aria-label={`Graph style: ${selectedChartStyle.label}`}
              onClick={() => setIsChartStyleMenuOpen((isOpen) => !isOpen)}
            >
              <span>Graph style: {selectedChartStyle.label}</span>
              <span className="chart-style-chevron" aria-hidden="true" />
            </button>
            {isChartStyleMenuOpen && (
              <div className="chart-style-menu" role="group" aria-label="Graph style">
                {chartStyles.map((style) => (
                  <button
                    key={style.value}
                    type="button"
                    className={chartStyle === style.value ? 'selected' : ''}
                    aria-pressed={chartStyle === style.value}
                    onClick={() => {
                      setChartStyle(style.value)
                      setIsChartStyleMenuOpen(false)
                    }}
                  >
                    {style.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </article>

        <article className="panel snapshot-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Announcements</p>
              <h3>New Update</h3>
            </div>
          </div>

          <div className="account-card accent">
            <div className="account-meta">
              <span>Budget note</span>
              <strong>New</strong>
            </div>
            <div className="account-balance">
              <small>Focus</small>
              <strong>{formatCurrency(18240)}</strong>
            </div>
          </div>

          <div className="account-card muted">
            <div className="account-meta">
              <span>ALERT!</span>
              <strong>On track</strong>
            </div>
            <div className="account-balance">
              <small>Saved this month</small>
              <strong>{formatCurrency(14680)}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="detail-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Recent</p>
              <h3>Transactions</h3>
            </div>
            <span className="meta-pill">{budgetUsage}% used</span>
          </div>

          <div className="budget-list">
            {budgetCategories.map((category) => {
              const ratio = Math.min((category.spent / category.limit) * 100, 100)
              return (
                <div key={category.name} className="budget-item">
                  <div className="budget-header">
                    <span>{category.name}</span>
                    <strong>
                      {formatCurrency(category.spent)} / {formatCurrency(category.limit)}
                    </strong>
                  </div>
                  <div className="progress-bar" aria-label={`${category.name} budget use`}>
                    <span className={`progress-fill ${category.color}`} style={{ width: `${ratio}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">CASH-IN</p>
              <h3>Transactions</h3>
            </div>
            <span className="meta-pill">Last 7 days</span>
          </div>

          <ul className="transaction-list">
            {transactions.map((item) => (
              <li key={`${item.merchant}-${item.date}`} className="transaction-item">
                <div>
                  <strong>{item.merchant}</strong>
                  <small>
                    {item.type} · {item.date}
                  </small>
                </div>
                <span className={item.tone}>{item.amount}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel side-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">CASH-OUT</p>
              <h3>Upcoming</h3>
            </div>
          </div>

          <ul className="bill-list">
            {upcomingBills.map((bill) => (
              <li key={bill.name} className="bill-item">
                <div>
                  <strong>{bill.name}</strong>
                  <small>{bill.due}</small>
                </div>
                <span>{bill.amount}</span>
              </li>
            ))}
          </ul>

          <div className="divider" />

          <div className="goal-section">
            <h4>Goals</h4>
            {goals.map((goal) => (
              <div key={goal.name} className="goal-item">
                <div className="goal-header">
                  <span>{goal.name}</span>
                  <strong>{goal.value}</strong>
                </div>
                <div className="progress-bar tiny" aria-label={`${goal.name} progress`}>
                  <span className="progress-fill blue" style={{ width: `${goal.progress}%` }} />
                </div>
                <small>{goal.target} target</small>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  )
}

type SavingsPageProps = {
  members: Member[]
  selectedMember: string
  isAdmin: boolean
  canEditSavings: boolean
  overallSavings: number
  onMemberChange: (member: string) => void
  onAddSavings: (memberName: string, amount: number, date: string) => void
  onPullOutSavings: (memberName: string, amount: number, date: string, reason: string) => void
}

function SavingsPage({
  members,
  selectedMember,
  isAdmin,
  canEditSavings,
  overallSavings,
  onMemberChange,
  onAddSavings,
  onPullOutSavings,
}: SavingsPageProps) {
  const [savingsMember, setSavingsMember] = useState('')
  const [savingsAmount, setSavingsAmount] = useState('')
  const [savingsDate, setSavingsDate] = useState(getLocalDate)
  const [savingsError, setSavingsError] = useState('')
  const [withdrawalMember, setWithdrawalMember] = useState('')
  const [withdrawalAmount, setWithdrawalAmount] = useState('')
  const [withdrawalDate, setWithdrawalDate] = useState(getLocalDate)
  const [withdrawalReason, setWithdrawalReason] = useState('')
  const [withdrawalError, setWithdrawalError] = useState('')
  const selectedWithdrawalMember = members.find((member) =>
    member.name === (withdrawalMember || (selectedMember !== 'all' ? selectedMember : '')),
  )
  const parsedWithdrawalAmount = Number(withdrawalAmount)
  const withdrawalFee = Number.isFinite(parsedWithdrawalAmount) && parsedWithdrawalAmount > 0
    ? parsedWithdrawalAmount * 0.1
    : 0

  const handleAddSavings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const memberName = isAdmin
      ? savingsMember || (selectedMember !== 'all' ? selectedMember : '')
      : members[0]?.name ?? ''
    const amount = Number(savingsAmount)

    if (!members.some((member) => member.name === memberName)) {
      setSavingsError('Select a member to add savings to.')
      return
    }

    if (savingsAmount === '' || !Number.isFinite(amount) || amount <= 0) {
      setSavingsError('Enter a savings amount greater than zero.')
      return
    }

    if (!savingsDate) {
      setSavingsError('Choose a date for this savings entry.')
      return
    }

    onAddSavings(memberName, amount, savingsDate)
    setSavingsAmount('')
    setSavingsDate(getLocalDate())
    setSavingsError('')
  }

  const handlePullOutSavings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const memberName = isAdmin
      ? withdrawalMember || (selectedMember !== 'all' ? selectedMember : '')
      : members[0]?.name ?? ''
    const amount = Number(withdrawalAmount)
    const member = members.find((entry) => entry.name === memberName)

    if (!member) {
      setWithdrawalError('Select a member to pull savings from.')
      return
    }

    if (withdrawalAmount === '' || !Number.isFinite(amount) || amount <= 0) {
      setWithdrawalError('Enter a pull-out amount greater than zero.')
      return
    }

    if (amount > getMemberSavings(member)) {
      setWithdrawalError('The pull-out amount cannot exceed this member’s savings.')
      return
    }

    if (!withdrawalDate || !withdrawalReason.trim()) {
      setWithdrawalError('Enter a date and reason for the pull-out.')
      return
    }

    onPullOutSavings(memberName, amount, withdrawalDate, withdrawalReason.trim())
    setWithdrawalAmount('')
    setWithdrawalDate(getLocalDate())
    setWithdrawalReason('')
    setWithdrawalError('')
  }

  const displayedInitialSavings = members
    .filter((member) => selectedMember === 'all' || member.name === selectedMember)
    .reduce((total, member) => total + getMemberSavings(member), 0)
  const selectedMemberDetails = members.find((member) => member.name === selectedMember)
  const totalSavings = members.reduce((total, member) => total + getMemberSavings(member), 0)
  const savingsHistory: Array<{
    id: string
    member: string
    type: string
    amount: number
    date: string
    reason?: string
    fee?: number
  }> = members
    .filter((member) => selectedMember === 'all' || member.name === selectedMember)
    .flatMap((member) => [
      {
        id: `${member.name}-initial`,
        member: member.name,
        type: 'Initial savings',
        amount: member.initialSavings,
        date: member.initialSavingsDate,
      },
      ...member.contributions.map((contribution, index) => ({
        id: `${member.name}-contribution-${index}`,
        member: member.name,
        type: 'Added savings',
        amount: contribution.amount,
        date: contribution.date,
      })),
      ...member.withdrawals.map((withdrawal, index) => ({
        id: `${member.name}-withdrawal-${index}`,
        member: member.name,
        type: 'Pull out savings',
        amount: -withdrawal.amount,
        date: withdrawal.date,
        reason: withdrawal.reason,
        fee: withdrawal.amount * 0.1,
      })),
    ])
    .sort((first, second) => second.date.localeCompare(first.date))

  return (
    <main className="page-view">
      <section className="page-header">
        <div>
          <p className="eyebrow">Savings</p>
          <h2>Growth tracker</h2>
        </div>
        <div className="member-controls">
          {isAdmin ? (
            <label className="member-select-label">
              Member
              <select
                value={selectedMember}
                onChange={(event) => onMemberChange(event.target.value)}
              >
                <option value="all">All</option>
                {members.map((member) => (
                  <option key={member.name} value={member.name}>{member.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <span className="member-select-label">Member: {members[0]?.name ?? 'No linked account'}</span>
          )}
        </div>
      </section>

      <section className="card-grid">
        <article className="panel stat-panel total-savings-card">
          <div className="mini-header">
            <span>{selectedMemberDetails?.name ?? 'Total savings'}</span>
            <strong>{formatCurrency(selectedMemberDetails ? getMemberSavings(selectedMemberDetails) : totalSavings)}</strong>
          </div>
          <small>{selectedMemberDetails ? 'Current savings' : 'Combined savings across all members'}</small>
          {selectedMemberDetails && (
            <div className="total-savings-summary">
              <span>All members total</span>
              <strong>{formatCurrency(overallSavings)}</strong>
            </div>
          )}
        </article>
        {savingsPlans.map((goal) => (
          <article
            key={goal.name}
            className={`panel stat-panel ${goal.name === 'Home down payment' ? 'member-savings-card' : ''}`}
          >
            <div className="mini-header">
              <span>{goal.name === 'Home down payment' ? 'Member Savings' : goal.name}</span>
              <strong>
                {goal.name === 'Home down payment' ? formatCurrency(displayedInitialSavings) : goal.value}
              </strong>
            </div>
            <div className="progress-bar" aria-label={`${goal.name} progress`}>
              <span
                className="progress-fill teal"
                style={{
                  width: `${goal.name === 'Home down payment'
                    ? Math.min((displayedInitialSavings / homeDownPaymentTarget) * 100, 100)
                    : goal.rate}%`,
                }}
              />
            </div>
            <small>{goal.target} target</small>
            {canEditSavings && goal.name === 'Home down payment' && (
              <div className="member-savings-actions">
                <form className="add-savings-form" noValidate onSubmit={handleAddSavings}>
                {isAdmin ? (
                  <label>
                    Member
                    <select
                      value={savingsMember || (selectedMember !== 'all' ? selectedMember : '')}
                      onChange={(event) => {
                        setSavingsMember(event.target.value)
                        setSavingsError('')
                      }}
                    >
                      <option value="">Select a member</option>
                      {members.map((member) => (
                        <option key={member.name} value={member.name}>{member.name}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span className="member-select-label">Member: {members[0]?.name}</span>
                )}
                <label>
                  Amount (PHP)
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={savingsAmount}
                    onChange={(event) => {
                      setSavingsAmount(event.target.value)
                      setSavingsError('')
                    }}
                    placeholder="0"
                  />
                </label>
                <label>
                  Date
                  <input
                    type="date"
                    required
                    value={savingsDate}
                    onChange={(event) => {
                      setSavingsDate(event.target.value)
                      setSavingsError('')
                    }}
                  />
                </label>
                <button type="submit" className="primary-button" disabled={members.length === 0}>
                  Add savings
                </button>
                {savingsError && <p className="member-error" role="alert">{savingsError}</p>}
                </form>
              </div>
            )}
          </article>
        ))}
        {canEditSavings && <article className="panel stat-panel pull-out-card">
          <div>
            <p className="eyebrow">Withdrawal</p>
            <h3>Pull out savings</h3>
          </div>
          <form className="pull-out-form" noValidate onSubmit={handlePullOutSavings}>
            {isAdmin ? (
              <label>
                Member
                <select
                  value={withdrawalMember || (selectedMember !== 'all' ? selectedMember : '')}
                  onChange={(event) => {
                    setWithdrawalMember(event.target.value)
                    setWithdrawalError('')
                  }}
                >
                  <option value="">Select a member</option>
                  {members.map((member) => (
                    <option key={member.name} value={member.name}>{member.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="member-select-label">Member: {members[0]?.name}</span>
            )}
            <label>
              Amount (PHP)
              <input
                type="number"
                min="0"
                step="any"
                value={withdrawalAmount}
                onChange={(event) => {
                  setWithdrawalAmount(event.target.value)
                  setWithdrawalError('')
                }}
                placeholder="0"
              />
            </label>
            <label>
              Date
              <input
                type="date"
                required
                value={withdrawalDate}
                onChange={(event) => {
                  setWithdrawalDate(event.target.value)
                  setWithdrawalError('')
                }}
              />
            </label>
            <label>
              Reason
              <input
                type="text"
                value={withdrawalReason}
                onChange={(event) => {
                  setWithdrawalReason(event.target.value)
                  setWithdrawalError('')
                }}
                placeholder="Reason for pull-out"
              />
            </label>
            <div className="withdrawal-summary">
              <span>10% deduction: {formatCurrency(withdrawalFee)}</span>
              <strong>
                Payout: {formatCurrency(Math.max(parsedWithdrawalAmount - withdrawalFee, 0))}
              </strong>
              {selectedWithdrawalMember && (
                <small>Available: {formatCurrency(getMemberSavings(selectedWithdrawalMember))}</small>
              )}
            </div>
            <button type="submit" className="secondary-button" disabled={members.length === 0}>
              Pull out savings
            </button>
            {withdrawalError && <p className="member-error" role="alert">{withdrawalError}</p>}
          </form>
        </article>}
      </section>

      <section className="panel full-width-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Savings History</p>
            <h3>Savings transactions</h3>
          </div>
        </div>
        {savingsHistory.length > 0 ? (
          <ul className="transaction-list savings-history-list">
            {savingsHistory.map((transaction) => (
              <li key={transaction.id} className="transaction-item">
                <div>
                  <strong>{transaction.type} · {transaction.member}</strong>
                  <small>
                    {formatDate(transaction.date)}
                    {transaction.reason && ` · ${transaction.reason}`}
                    {transaction.fee !== undefined && ` · 10% fee: ${formatCurrency(transaction.fee)}`}
                  </small>
                </div>
                <span className={transaction.amount < 0 ? 'negative' : 'positive'}>
                  {transaction.amount < 0 ? '-' : '+'}{formatCurrency(Math.abs(transaction.amount))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="savings-history-empty">No savings transactions for this selection yet.</p>
        )}
      </section>
    </main>
  )
}

function LoansPage({
  borrowers,
  onAddBorrower,
  onAddBorrowerInterest,
  onPayBorrowerInterest,
}: {
  borrowers: Borrower[]
  onAddBorrower: (borrower: Borrower) => void
  onAddBorrowerInterest: (borrowerId: string) => void
  onPayBorrowerInterest: (borrowerId: string, amount: number) => void
}) {
  const [isAddingBorrower, setIsAddingBorrower] = useState(false)
  const [borrowerName, setBorrowerName] = useState('')
  const [borrowerLoanAmount, setBorrowerLoanAmount] = useState('')
  const [borrowerError, setBorrowerError] = useState('')
  const [payingBorrowerId, setPayingBorrowerId] = useState<string | null>(null)
  const [interestPaymentAmount, setInterestPaymentAmount] = useState('')
  const [interestPaymentError, setInterestPaymentError] = useState('')
  const borrowerLoanValue = Number(borrowerLoanAmount)
  const paydayInterest = Number.isFinite(borrowerLoanValue) && borrowerLoanValue > 0
    ? borrowerLoanValue * 0.03
    : 0

  const handleAddBorrower = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = borrowerName.trim()
    const loanAmount = Number(borrowerLoanAmount)
    if (!name) {
      setBorrowerError('Enter the borrower’s name.')
      return
    }
    if (borrowerLoanAmount === '' || !Number.isFinite(loanAmount) || loanAmount <= 0) {
      setBorrowerError('Enter a loan amount greater than zero.')
      return
    }

    onAddBorrower({
      id: crypto.randomUUID(),
      name,
      email: '',
      loanAmount,
      paydayInterest: loanAmount * 0.03,
      createdAt: new Date().toISOString(),
      transactions: [{
        id: crypto.randomUUID(),
        type: 'loan',
        amount: loanAmount,
        date: getLocalDate(),
      }],
    })
    setBorrowerName('')
    setBorrowerLoanAmount('')
    setBorrowerError('')
    setIsAddingBorrower(false)
  }

  const handlePayBorrowerInterest = (event: FormEvent<HTMLFormElement>, borrower: Borrower) => {
    event.preventDefault()
    const amount = Number(interestPaymentAmount)
    if (interestPaymentAmount === '' || !Number.isFinite(amount) || amount <= 0) {
      setInterestPaymentError('Enter an amount greater than zero.')
      return
    }
    const roundedAmount = Number(amount.toFixed(2))
    if (roundedAmount <= 0) {
      setInterestPaymentError('Enter an amount of at least 0.01.')
      return
    }
    if (roundedAmount > borrower.paydayInterest) {
      setInterestPaymentError('Payment cannot exceed the current interest due.')
      return
    }

    onPayBorrowerInterest(borrower.id, roundedAmount)
    setPayingBorrowerId(null)
    setInterestPaymentAmount('')
    setInterestPaymentError('')
  }

  return (
    <main className="page-view">
      <section className="page-header loans-page-header">
        <div className="loans-title">
          <p className="eyebrow">Loans</p>
          <h2>LOANS</h2>
        </div>
        <time className="loans-current-date" dateTime={getLocalDate()}>{formatDate(getLocalDate())}</time>
        <div className="loans-actions">
          <button type="button" className="secondary-button" onClick={() => setIsAddingBorrower((open) => !open)}>
            {isAddingBorrower ? 'Cancel' : 'Add borrower'}
          </button>
          <button type="button" className="secondary-button">Pay schedule</button>
        </div>
      </section>

      {isAddingBorrower && (
        <form className="add-borrower-form" noValidate onSubmit={handleAddBorrower}>
          <label>
            Borrower name
            <input
              autoFocus
              required
              value={borrowerName}
              onChange={(event) => {
                setBorrowerName(event.target.value)
                setBorrowerError('')
              }}
              placeholder="Full name"
            />
          </label>
          <label>
            Payday interest (3%)
            <output>{formatCurrency(paydayInterest)}</output>
          </label>
          <label>
            Loan amount (PHP)
            <input
              type="number"
              min="0.01"
              step="any"
              required
              value={borrowerLoanAmount}
              onChange={(event) => {
                setBorrowerLoanAmount(event.target.value)
                setBorrowerError('')
              }}
              placeholder="0"
            />
          </label>
          <button type="submit" className="primary-button">Save borrower</button>
          {borrowerError && <p className="member-error" role="alert">{borrowerError}</p>}
        </form>
      )}

      <section className="panel full-width-panel borrower-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Borrowers</p>
            <h3>Borrower directory</h3>
          </div>
          <span className="meta-pill">{borrowers.length} total</span>
        </div>
        {borrowers.length > 0 ? (
          <ul className="borrower-list">
            {borrowers.map((borrower) => (
              <li key={borrower.id} className="borrower-item">
                <div className="borrower-item-header">
                  <strong>{borrower.name}</strong>
                  <div className="borrower-actions">
                    <button
                      type="button"
                      className="secondary-button borrower-interest-button"
                      onClick={() => onAddBorrowerInterest(borrower.id)}
                    >
                      Add interest
                    </button>
                    <button
                      type="button"
                      className="secondary-button borrower-interest-button"
                      disabled={borrower.paydayInterest <= 0}
                      onClick={() => {
                        setPayingBorrowerId((currentId) => currentId === borrower.id ? null : borrower.id)
                        setInterestPaymentAmount('')
                        setInterestPaymentError('')
                      }}
                    >
                      Pay interest
                    </button>
                  </div>
                </div>
                <div className="borrower-metrics">
                  <span><strong>Principal:</strong> {formatCurrency(borrower.loanAmount)}</span>
                  <span><strong>Interest:</strong> {formatCurrency(borrower.paydayInterest)}</span>
                </div>
                {payingBorrowerId === borrower.id && (
                  <form
                    className="interest-payment-form"
                    noValidate
                    onSubmit={(event) => handlePayBorrowerInterest(event, borrower)}
                  >
                    <label>
                      Payment amount (up to {formatCurrency(borrower.paydayInterest)})
                      <input
                        type="number"
                        min="0.01"
                        max={borrower.paydayInterest}
                        step="any"
                        required
                        value={interestPaymentAmount}
                        onChange={(event) => {
                          setInterestPaymentAmount(event.target.value)
                          setInterestPaymentError('')
                        }}
                        placeholder="0"
                      />
                    </label>
                    <button type="submit" className="primary-button">Record payment</button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setPayingBorrowerId(null)
                        setInterestPaymentError('')
                      }}
                    >
                      Cancel
                    </button>
                    {interestPaymentError && <p className="member-error" role="alert">{interestPaymentError}</p>}
                  </form>
                )}
                <div className="loan-transactions">
                  <small>Loan transactions</small>
                  {borrower.transactions && borrower.transactions.length > 0 ? (
                    <ul className="loan-transaction-list">
                      {borrower.transactions.map((transaction) => (
                        <li key={transaction.id} className="loan-transaction-item">
                          <span className={`transaction-type ${transaction.type}`}>
                            {transaction.type === 'interest-payment' ? 'Interest paid' : transaction.type === 'interest' ? 'Interest' : 'Loan'}
                          </span>
                          <strong>{transaction.type === 'interest-payment' ? '-' : ''}{formatCurrency(transaction.amount)}</strong>
                          <time>{formatDate(transaction.date)}</time>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="loan-transactions-empty">No loan transactions yet.</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="savings-history-empty">No borrowers added yet.</p>
        )}
      </section>

      <section className="card-grid">
        {loanOverview.map((loan) => (
          <article key={loan.name} className="panel stat-panel">
            <div className="mini-header">
              <span>{loan.name}</span>
              <strong>{loan.balance}</strong>
            </div>
            <div className="info-row">
              <small>Rate</small>
              <span>{loan.rate}</span>
            </div>
            <div className="info-row">
              <small>Monthly payment</small>
              <span>{loan.payment}</span>
            </div>
          </article>
        ))}
      </section>

      <section className="panel full-width-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Projection</p>
            <h3>Debt payoff timing</h3>
          </div>
        </div>
        <div className="stats-grid">
          <div className="stat-box">
            <span>Total debt</span>
            <strong>₱205,100</strong>
          </div>
          <div className="stat-box">
            <span>Interest saved</span>
            <strong>₱4,820</strong>
          </div>
          <div className="stat-box">
            <span>Payoff date</span>
            <strong>2029-07</strong>
          </div>
        </div>
      </section>
    </main>
  )
}

function ProfitsPage() {
  return (
    <main className="page-view">
      <section className="page-header">
        <div>
          <p className="eyebrow">Profits</p>
          <h2>Performance summary</h2>
        </div>
      </section>

      <section className="summary-grid">
        {profitsData.map((item) => (
          <article key={item.label} className="summary-card">
            <p>{item.label}</p>
            <h2>{item.value}</h2>
            <span className={item.tone}>vs last month</span>
          </article>
        ))}
      </section>

      <section className="panel full-width-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Earnings</p>
            <h3>Revenue mix</h3>
          </div>
        </div>
        <div className="stats-grid">
          <div className="stat-box">
            <span>Salary</span>
            <strong>₱42,400</strong>
          </div>
          <div className="stat-box">
            <span>Investments</span>
            <strong>₱13,600</strong>
          </div>
          <div className="stat-box">
            <span>Side income</span>
            <strong>₱7,900</strong>
          </div>
        </div>
      </section>
    </main>
  )
}

type DataPageProps = {
  databaseMessage: string
  isDatabaseConnecting: boolean
  canChooseDatabaseFolder: boolean
  onChooseDatabaseFolder: () => void
}

function DataPage({
  databaseMessage,
  isDatabaseConnecting,
  canChooseDatabaseFolder,
  onChooseDatabaseFolder,
}: DataPageProps) {
  return (
    <main className="page-view">
      <section className="page-header">
        <div>
          <p className="eyebrow">Data</p>
          <h2>Financial insights</h2>
          <p className="database-status" role="status">{databaseMessage}</p>
        </div>
        <button
          type="button"
          className="primary-button"
          disabled={isDatabaseConnecting || !canChooseDatabaseFolder}
          onClick={onChooseDatabaseFolder}
        >
          {isDatabaseConnecting ? 'Connecting…' : 'Choose or change database folder'}
        </button>
      </section>

      <section className="card-grid">
        {dataBreakdown.map((entry) => (
          <article key={entry.label} className="panel stat-panel">
            <div className="mini-header">
              <span>{entry.label}</span>
              <strong>{entry.value}</strong>
            </div>
            <div className="progress-bar">
              <span className="progress-fill blue" style={{ width: entry.value }} />
            </div>
          </article>
        ))}
      </section>

      <section className="panel full-width-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Sync</p>
            <h3>Connected sources</h3>
          </div>
        </div>
        <div className="stats-grid">
          <div className="stat-box">
            <span>Bank accounts</span>
            <strong>4 linked</strong>
          </div>
          <div className="stat-box">
            <span>Cards</span>
            <strong>3 active</strong>
          </div>
          <div className="stat-box">
            <span>Data freshness</span>
            <strong>Updated 4 min ago</strong>
          </div>
        </div>
      </section>
    </main>
  )
}

function AccountPage({ name, email }: { name: string; email: string }) {
  return (
    <main className="page-view">
      <section className="page-header">
        <div>
          <p className="eyebrow">My account</p>
          <h2>Account details</h2>
        </div>
      </section>
      <section className="panel full-width-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Member account</p>
            <h3>{name}</h3>
          </div>
        </div>
        <div className="stats-grid">
          <div className="stat-box">
            <span>Name</span>
            <strong>{name}</strong>
          </div>
          <div className="stat-box">
            <span>Email</span>
            <strong>{email}</strong>
          </div>
          <div className="stat-box">
            <span>Role</span>
            <strong>Member</strong>
          </div>
        </div>
      </section>
    </main>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [isRegisterMode, setIsRegisterMode] = useState(false)
  const [loginMessage, setLoginMessage] = useState('')
  const [members, setMembers] = useState<Member[]>(loadSavedMembers)
  const [accounts, setAccounts] = useState<DatabaseAccount[]>([])
  const [borrowers, setBorrowers] = useState<Borrower[]>([])
  const [signedInUser, setSignedInUser] = useState('')
  const [signedInEmail, setSignedInEmail] = useState('')
  const [signedInRole, setSignedInRole] = useState<AccountRole | null>(null)
  const [selectedMember, setSelectedMember] = useState('all')
  const [databaseMessage, setDatabaseMessage] = useState('Loading saved data…')
  const [isDatabaseConnecting, setIsDatabaseConnecting] = useState(false)
  const [canChooseDatabaseFolder, setCanChooseDatabaseFolder] = useState(supportsDatabaseFolder)
  const databaseDirectory = useRef<DatabaseDirectoryHandle | null>(null)
  const initialMembers = useRef(members)
  const initialAccounts = useRef(accounts)
  const initialBorrowers = useRef(borrowers)
  const totalSavings = members.reduce((total, member) => total + getMemberSavings(member), 0)
  const signedInMember = members.find((member) =>
    member.accountEmail?.trim().toLowerCase() === signedInEmail.trim().toLowerCase(),
  )

    useEffect(() => {
    document.documentElement.dataset.theme = isDarkMode ? 'dark' : 'light'
  }, [isDarkMode])

  useEffect(() => {
    let isActive = true

    const restoreDatabase = async () => {
      if (!supportsDatabaseFolder()) {
        setCanChooseDatabaseFolder(false)
        setDatabaseMessage('Your data is saved on this device. Folder-based Excel sync requires Chrome or Edge.')
        return
      }

      try {
        const directory = await loadSavedDirectory()
        if (!isActive) return
        if (!directory) {
          setDatabaseMessage('Your data is saved on this device. Choose a folder to create an Excel database.')
          return
        }

        databaseDirectory.current = directory
        const permission = await directory.queryPermission({ mode: 'readwrite' })
        if (!isActive) return
        if (permission !== 'granted') {
          setDatabaseMessage(`Excel database folder: ${directory.name}. Select the folder again to reconnect.`)
          return
        }

        const workbookData = await readWorkbookData(directory)
        if (!isActive) return
        if (workbookData) {
          setMembers(syncAccountMembers(workbookData.accounts, workbookData.members))
          setAccounts(workbookData.accounts)
          setBorrowers(workbookData.borrowers)
        } else {
          await writeWorkbookData(directory, initialMembers.current, initialAccounts.current, initialBorrowers.current)
        }
        setDatabaseMessage(`Excel database connected: ${directory.name}`)
      } catch (error) {
        if (!isActive) return
        setDatabaseMessage(`Saved data is safe on this device. Excel database could not be opened: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    void restoreDatabase()
    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    saveMembersLocally(members)
    const directory = databaseDirectory.current
    if (!directory) return

    let isActive = true
    const syncWorkbook = async () => {
      try {
        const permission = await directory.queryPermission({ mode: 'readwrite' })
        if (!isActive) return
        if (permission !== 'granted') {
          setDatabaseMessage(`Your data is safe on this device. Reconnect the Excel database folder "${directory.name}" to resume syncing.`)
          return
        }

        setDatabaseMessage(`Saving Excel database: ${directory.name}…`)
        await writeWorkbookData(directory, members, accounts, borrowers)
        if (isActive) setDatabaseMessage(`Excel database connected: ${directory.name}`)
      } catch (error) {
        if (!isActive) return
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('not allowed by the user agent') || message.includes('current context')) {
          setDatabaseMessage(`Your data is safe on this device. Reconnect the Excel database folder "${directory.name}" to grant access again.`)
          return
        }
        setDatabaseMessage(`Saved data is safe on this device. Excel sync failed: ${message}`)
      }
    }

    void syncWorkbook()

    return () => {
      isActive = false
    }
  }, [members, accounts, borrowers])

  const handleChooseDatabaseFolder = async () => {
    setIsDatabaseConnecting(true)
    try {
      const directory = await chooseDatabaseDirectory()
      const workbookData = await readWorkbookData(directory)
      let connectedMembers = members
      let connectedAccounts = accounts
      let connectedBorrowers = borrowers
      if (workbookData) {
        connectedMembers = syncAccountMembers(workbookData.accounts, workbookData.members)
        connectedAccounts = workbookData.accounts
        connectedBorrowers = workbookData.borrowers
      } else {
        await writeWorkbookData(directory, connectedMembers, connectedAccounts, connectedBorrowers)
      }
      await saveDirectory(directory)
      databaseDirectory.current = directory
      setMembers(connectedMembers)
      setAccounts(connectedAccounts)
      setBorrowers(connectedBorrowers)
      setDatabaseMessage(`Excel database connected: ${directory.name}`)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setDatabaseMessage('Folder selection cancelled. Your data remains saved on this device.')
      } else {
        setDatabaseMessage(`Saved data is safe on this device. Excel database could not be connected: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    } finally {
      setIsDatabaseConnecting(false)
    }
  }

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    const password = String(formData.get('password') ?? '')
    const name = String(formData.get('name') ?? '').trim()
    const startingSavings = Number(formData.get('initialSavings') ?? 0)
    setLoginMessage('Checking the Excel database…')

    try {
      const directory = databaseDirectory.current
      if (!directory) {
        throw new Error('Choose the database folder above before registering or signing in.')
      }

      const permission = await directory.queryPermission({ mode: 'readwrite' })
      if (permission !== 'granted') {
        throw new Error('Database folder access has expired. Choose or change the database folder above, then try again.')
      }

      const workbookData = await readWorkbookData(directory)
      const savedMembers = workbookData?.members ?? members
      const savedAccounts = workbookData?.accounts ?? accounts
      const savedBorrowers = workbookData?.borrowers ?? borrowers
      databaseDirectory.current = directory
      await saveDirectory(directory)

      if (isRegisterMode) {
        if (!Number.isFinite(startingSavings) || startingSavings < 0) {
          throw new Error('Enter an initial savings amount of zero or more.')
        }
        if (savedAccounts.some((account) => account.email === email)) {
          throw new Error('An account with that email already exists.')
        }

        const { salt, passwordHash } = await createPasswordHash(password)
        const role: AccountRole = savedAccounts.length === 0 ? 'admin' : 'member'
        const account: DatabaseAccount = {
          email,
          name,
          role,
          salt,
          passwordHash,
          createdAt: new Date().toISOString(),
        }
        const updatedAccounts = [...savedAccounts, account]
        const updatedMembers = syncAccountMembers(updatedAccounts, savedMembers)
        const accountMember = updatedMembers.find((member) => member.accountEmail === email)
        if (accountMember && startingSavings > 0) {
          const today = getLocalDate()
          const hasExistingSavings = accountMember.initialSavings > 0
            || accountMember.contributions.length > 0
            || accountMember.withdrawals.length > 0
          if (hasExistingSavings) {
            accountMember.contributions.push({ amount: startingSavings, date: today })
          } else {
            accountMember.initialSavings = startingSavings
            accountMember.initialSavingsDate = today
          }
        }
        await writeWorkbookData(directory, updatedMembers, updatedAccounts, savedBorrowers)
        setMembers(updatedMembers)
        setAccounts(updatedAccounts)
        setBorrowers(savedBorrowers)
        setDatabaseMessage(`Excel database connected: ${directory.name}`)
        setSignedInUser(account.name)
        setSignedInEmail(account.email)
        setSignedInRole(account.role)
      } else {
        const account = savedAccounts.find((savedAccount) => savedAccount.email === email)
        if (!account || !(await verifyPassword(password, account))) {
          throw new Error('Email or password is incorrect.')
        }
        setMembers(syncAccountMembers(savedAccounts, savedMembers))
        setAccounts(savedAccounts)
        setBorrowers(savedBorrowers)
        setSignedInUser(account.name)
        setSignedInEmail(account.email)
        setSignedInRole(account.role)
      }

      setActiveTab('overview')
      setLoginMessage('')
      setIsLoginOpen(false)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setLoginMessage('Folder selection cancelled. Choose a database folder to continue registering or signing in.')
      } else {
        setLoginMessage(error instanceof Error ? error.message : 'Could not access the Excel database.')
      }
    } finally {
      const passwordInput = form.elements.namedItem('password')
      if (passwordInput instanceof HTMLInputElement) passwordInput.value = ''
    }
  }

  const addSavings = (memberName: string, amount: number, date: string) => {
    const canEditMemberSavings = (member: Member) =>
      signedInRole === 'admin'
      || (signedInRole === 'member'
        && Boolean(signedInEmail.trim())
        && member.accountEmail?.trim().toLowerCase() === signedInEmail.trim().toLowerCase())
    setMembers((currentMembers) =>
      currentMembers.map((member) =>
        member.name === memberName && canEditMemberSavings(member)
          ? { ...member, contributions: [...member.contributions, { amount, date }] }
          : member,
      ),
    )
  }

  const pullOutSavings = (memberName: string, amount: number, date: string, reason: string) => {
    const canEditMemberSavings = (member: Member) =>
      signedInRole === 'admin'
      || (signedInRole === 'member'
        && Boolean(signedInEmail.trim())
        && member.accountEmail?.trim().toLowerCase() === signedInEmail.trim().toLowerCase())
    setMembers((currentMembers) =>
      currentMembers.map((member) =>
        member.name === memberName && canEditMemberSavings(member)
          ? { ...member, withdrawals: [...member.withdrawals, { amount, date, reason }] }
          : member,
      ),
    )
  }

  const addBorrower = (borrower: Borrower) => {
    if (signedInRole !== 'admin') return
    setBorrowers((currentBorrowers) => [...currentBorrowers, borrower])
  }

  const addBorrowerInterest = (borrowerId: string) => {
    if (signedInRole !== 'admin') return
    setBorrowers((currentBorrowers) => currentBorrowers.map((borrower) => {
      if (borrower.id !== borrowerId) return borrower
      const accruedInterest = Number((borrower.loanAmount * 0.03).toFixed(2))
      const nextPaydayInterest = Number((borrower.paydayInterest + accruedInterest).toFixed(2))
      const nextTransaction = {
        id: crypto.randomUUID(),
        type: 'interest' as const,
        amount: accruedInterest,
        date: getLocalDate(),
      }
      return {
        ...borrower,
        paydayInterest: nextPaydayInterest,
        transactions: [...(borrower.transactions ?? []), nextTransaction],
      }
    }))
  }

  const payBorrowerInterest = (borrowerId: string, amount: number) => {
    if (signedInRole !== 'admin' || !Number.isFinite(amount) || amount <= 0) return
    setBorrowers((currentBorrowers) => currentBorrowers.map((borrower) => {
      if (borrower.id !== borrowerId || amount > borrower.paydayInterest) return borrower
      const remainingInterest = Number((borrower.paydayInterest - amount).toFixed(2))
      const nextTransaction = {
        id: crypto.randomUUID(),
        type: 'interest-payment' as const,
        amount,
        date: getLocalDate(),
      }
      return {
        ...borrower,
        paydayInterest: Math.max(0, remainingInterest),
        transactions: [...(borrower.transactions ?? []), nextTransaction],
      }
    }))
  }

  const renderPage = () => {
    if (signedInRole !== 'admin') {
      if (activeTab === 'overview') return <OverviewPage totalSavings={totalSavings} />
      if (activeTab === 'savings') {
        return (
          <SavingsPage
            members={signedInMember ? [signedInMember] : []}
            selectedMember={signedInMember?.name ?? ''}
            isAdmin={false}
            canEditSavings={Boolean(signedInMember)}
            overallSavings={totalSavings}
            onMemberChange={() => undefined}
            onAddSavings={addSavings}
            onPullOutSavings={pullOutSavings}
          />
        )
      }
      return <AccountPage name={signedInUser} email={signedInEmail} />
    }

    switch (activeTab) {
      case 'savings':
        return (
          <SavingsPage
            members={members}
            selectedMember={selectedMember}
            overallSavings={totalSavings}
            isAdmin
            canEditSavings
            onMemberChange={setSelectedMember}
            onAddSavings={addSavings}
            onPullOutSavings={pullOutSavings}
          />
        )
      case 'loans':
        return (
          <LoansPage
            borrowers={borrowers}
            onAddBorrower={addBorrower}
            onAddBorrowerInterest={addBorrowerInterest}
            onPayBorrowerInterest={payBorrowerInterest}
          />
        )
      case 'profits':
        return <ProfitsPage />
      case 'data':
        return (
          <DataPage
            databaseMessage={databaseMessage}
            isDatabaseConnecting={isDatabaseConnecting}
            canChooseDatabaseFolder={canChooseDatabaseFolder}
            onChooseDatabaseFolder={handleChooseDatabaseFolder}
          />
        )
      case 'overview':
      default:
        return <OverviewPage totalSavings={totalSavings} />
    }
  }

  return (
    <div className="app-shell" data-theme={isDarkMode ? 'dark' : 'light'}>
      <button
        type="button"
        className="theme-toggle"
        aria-label={`Switch to ${isDarkMode ? 'light' : 'dark'} mode`}
        title={`Switch to ${isDarkMode ? 'light' : 'dark'} mode`}
        onClick={() => setIsDarkMode((currentMode) => !currentMode)}
      >
        <span aria-hidden="true">{isDarkMode ? '☼' : '☾'}</span>
      </button>
      {signedInUser ? (
        <>
          <header className="topbar">
            <div>
              <p className="eyebrow">Welcome back</p>
              <h1>{signedInUser}</h1>
            </div>
            <div className="topbar-actions">
              <nav className="main-nav" aria-label="Primary navigation">
                {(signedInRole === 'admin' ? tabs : tabs.slice(0, 2)).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`nav-link ${activeTab === tab.id ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
              <button
                type="button"
                className="login-button"
                onClick={() => {
                  if (!window.confirm('Are you sure you want to sign out?')) return
                  setSignedInUser('')
                  setSignedInEmail('')
                  setSignedInRole(null)
                  setLoginMessage('')
                  setIsRegisterMode(false)
                }}
              >
                Sign out ({signedInUser})
              </button>
              {signedInRole && (
                <span className={`account-role ${signedInRole}`}>
                  {signedInRole === 'admin' ? 'Administrator' : 'Member'}
                </span>
              )}
            </div>
          </header>
          {renderPage()}
        </>
      ) : (
        <main className="auth-locked-screen" aria-label="Sign in required">
          <p className="eyebrow">Funds Organizer</p>
          <h1>Sign in to continue</h1>
          <p>Your savings dashboard is locked until you sign in.</p>
        </main>
      )}

      {(!signedInUser || isLoginOpen) && (
        createPortal(
          <div
            className={`login-overlay ${signedInUser ? '' : 'login-overlay-locked'}`}
            data-theme={isDarkMode ? 'dark' : 'light'}
            onClick={(event) => {
              if (signedInUser && event.target === event.currentTarget) setIsLoginOpen(false)
            }}
            onKeyDown={(event) => {
              if (signedInUser && event.key === 'Escape') setIsLoginOpen(false)
            }}
          >
            <section className="login-dialog" role="dialog" aria-modal="true" aria-labelledby="login-title">
            <div className="login-dialog-header">
              <div>
                <p className="eyebrow">Funds Organizer</p>
                <h2 id="login-title">{isRegisterMode ? 'Create account' : 'Log in'}</h2>
              </div>
              {signedInUser && (
                <button
                  type="button"
                  className="login-close-button"
                  aria-label="Close login dialog"
                  onClick={() => setIsLoginOpen(false)}
                >
                  ×
                </button>
              )}
            </div>
            {!signedInUser && (
              <div className="login-database-setup">
                <p className="login-note">{databaseMessage}</p>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isDatabaseConnecting || !canChooseDatabaseFolder}
                  onClick={() => void handleChooseDatabaseFolder()}
                >
                  {isDatabaseConnecting ? 'Connecting…' : 'Choose or change database folder'}
                </button>
              </div>
            )}
            <form
              className="login-form"
              onSubmit={(event) => void handleAuthSubmit(event)}
            >
              {isRegisterMode && (
                <>
                  <label>
                    Full name
                    <input type="text" name="name" autoComplete="name" required autoFocus />
                  </label>
                  {accounts.length === 0 && (
                    <label>
                      Initial savings (PHP)
                      <input
                        type="number"
                        name="initialSavings"
                        min="0"
                        step="any"
                        defaultValue="0"
                        required
                      />
                    </label>
                  )}
                  <label>
                    Account role
                    <select value={accounts.length === 0 ? 'admin' : 'member'} disabled>
                      <option value="admin">Administrator</option>
                      <option value="member">Member</option>
                    </select>
                  </label>
                  <p className="login-note">
                    The first account in this database is the administrator. Later accounts are members.
                  </p>
                </>
              )}
              <label>
                Email address
                <input type="email" name="email" autoComplete="email" required autoFocus={!isRegisterMode} />
              </label>
              <label>
                Password
                <input
                  type="password"
                  name="password"
                  autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
                  minLength={isRegisterMode ? 8 : undefined}
                  required
                />
              </label>
              <button type="submit" className="primary-button">
                {isRegisterMode ? 'Create account' : 'Sign in'}
              </button>
              <p className="login-note" role="status">
                {loginMessage || 'Accounts are checked and stored in the selected Excel database.'}
              </p>
              <p className="login-switch">
                {isRegisterMode ? 'Already have an account?' : 'New here?'}
                <button
                  type="button"
                  onClick={() => {
                    setIsRegisterMode((isRegistering) => !isRegistering)
                    setLoginMessage('')
                  }}
                >
                  {isRegisterMode ? 'Log in' : 'Register'}
                </button>
              </p>
            </form>
            </section>
          </div>,
          document.body,
        )
      )}
    </div>
  )
}

export default App
