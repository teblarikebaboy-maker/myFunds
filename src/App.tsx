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
  type RemovedBorrowerTransaction,
} from './database'
import './App.css'

type TabKey = 'overview' | 'savings' | 'loans' | 'profits' | 'data'
type ChartStyle = 'bar' | 'line'
type SavingsTransaction = {
  id: string
  member: string
  type: string
  amount: number
  date: string
  reason?: string
  fee?: number
}

const getMemberSavings = (member: Member) =>
  member.initialSavings
  + member.contributions.reduce((total, contribution) => total + contribution.amount, 0)
  - member.withdrawals.reduce((total, withdrawal) => total + withdrawal.amount, 0)

const getMemberSavingsTransactions = (member: Member): SavingsTransaction[] => [
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
].sort((first, second) => second.date.localeCompare(first.date))

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
  { label: 'Total Profits', value: '₱0.00', delta: 'Interest paid', tone: 'positive' },
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

const formatBorrowerCurrency = (amount: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)

const formatPercentage = (value: number) => `${value.toFixed(1)}%`

const hasOutstandingBorrowerBalance = (amount: number) => Math.round(amount * 100) !== 0

const getTotalInterestPaid = (borrowers: Borrower[], removedTransactions: RemovedBorrowerTransaction[]) =>
  borrowers.reduce((total, borrower) =>
    total + (borrower.transactions ?? [])
      .filter((transaction) => transaction.type === 'interest-payment')
      .reduce((borrowerTotal, transaction) => borrowerTotal + transaction.amount, 0),
  0)
  + removedTransactions.reduce((total, { transaction }) =>
    total + (transaction.type === 'interest-payment' ? transaction.amount : 0),
  0)

const getLocalDate = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}

const formatDate = (date: string) =>
  new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
    .format(new Date(`${date}T00:00:00`))

const currentYear = new Date().getFullYear()

function OverviewPage({
  totalSavings,
  totalLoanProceeds,
  totalInterestPaid,
}: {
  totalSavings: number
  totalLoanProceeds: number
  totalInterestPaid: number
}) {
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
            <h2>
              {card.label === 'Available funds'
                ? formatCurrency(totalSavings - totalLoanProceeds)
                : card.label === 'Total Savings'
                  ? formatCurrency(totalSavings)
                  : card.label === 'Loans Proceeds'
                    ? formatCurrency(totalLoanProceeds)
                    : card.label === 'Total Profits'
                      ? formatCurrency(totalInterestPaid)
                      : card.value}
            </h2>
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
  borrowers: Borrower[]
  selectedMember: string
  isAdmin: boolean
  canEditSavings: boolean
  overallSavings: number
  onMemberChange: (member: string) => void
  onAddSavings: (memberName: string, amount: number, date: string) => void
  onPullOutSavings: (memberName: string, amount: number, date: string, reason: string) => void
  onDeleteMember: (memberName: string, adminPassword: string) => Promise<{ success: boolean; message?: string }>
}

function SavingsPage({
  members,
  borrowers,
  selectedMember,
  isAdmin,
  canEditSavings,
  overallSavings,
  onMemberChange,
  onAddSavings,
  onPullOutSavings,
  onDeleteMember,
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
  const [memberSearch, setMemberSearch] = useState('')
  const [deletingMemberName, setDeletingMemberName] = useState<string | null>(null)
  const [deleteAdminPassword, setDeleteAdminPassword] = useState('')
  const [deleteMemberError, setDeleteMemberError] = useState('')
  const [isDeletingMember, setIsDeletingMember] = useState(false)
  const filteredMembers = members.filter((member) =>
    member.name.toLowerCase().includes(memberSearch.trim().toLowerCase()),
  )
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

  const handleDeleteMember = async (event: FormEvent<HTMLFormElement>, memberName: string) => {
    event.preventDefault()
    setIsDeletingMember(true)
    setDeleteMemberError('')
    try {
      const result = await onDeleteMember(memberName, deleteAdminPassword)
      if (!result.success) {
        setDeleteMemberError(result.message ?? 'The member could not be deleted.')
        return
      }
      setDeletingMemberName(null)
      setDeleteAdminPassword('')
      setDeleteMemberError('')
    } catch (error) {
      setDeleteMemberError(error instanceof Error ? error.message : 'Could not verify the admin password.')
    } finally {
      setIsDeletingMember(false)
    }
  }

  const displayedInitialSavings = members
    .filter((member) => selectedMember === 'all' || member.name === selectedMember)
    .reduce((total, member) => total + getMemberSavings(member), 0)
  const selectedMemberDetails = members.find((member) => member.name === selectedMember)
  const totalSavings = members.reduce((total, member) => total + getMemberSavings(member), 0)
  const getSavingsShare = (member: Member) => totalSavings > 0 ? (getMemberSavings(member) / totalSavings) * 100 : 0
  const savingsHistory: SavingsTransaction[] = members
    .filter((member) => selectedMember === 'all' || member.name === selectedMember)
    .flatMap(getMemberSavingsTransactions)
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

      <section className="panel full-width-panel savings-directory-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Savings</p>
            <h3>Member directory</h3>
          </div>
          <div className="borrower-directory-controls">
            <input
              className="borrower-search"
              type="search"
              aria-label="Search members"
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
              placeholder="Search members"
            />
            <span className="meta-pill">{members.length} total</span>
          </div>
        </div>
        {members.length > 0 ? (
          filteredMembers.length > 0 ? (
            <ul className="savings-directory-list">
              {filteredMembers.map((member) => (
                <li key={member.name} className="savings-directory-item">
                  <div className="savings-member-header">
                    <strong>{member.name}</strong>
                    {isAdmin && (
                      <button
                        type="button"
                        className="secondary-button delete-member-button"
                        onClick={() => {
                          setDeletingMemberName((currentName) => currentName === member.name ? null : member.name)
                          setDeleteAdminPassword('')
                          setDeleteMemberError('')
                        }}
                      >
                        {deletingMemberName === member.name ? 'Cancel' : 'Delete'}
                      </button>
                    )}
                  </div>
                  <div className="savings-member-metrics">
                    <div className="savings-member-metric">
                      <span>Current savings</span>
                      <strong>
                        {formatCurrency(getMemberSavings(member))}
                        <small>{formatPercentage(getSavingsShare(member))}</small>
                      </strong>
                    </div>
                    <div className="savings-member-metric">
                      <span>Amount guaranteed</span>
                      <strong>{formatCurrency(borrowers
                        .filter((borrower) => borrower.guarantorName?.trim().toLowerCase() === member.name.trim().toLowerCase())
                        .reduce((total, borrower) => total + borrower.loanAmount, 0))}</strong>
                    </div>
                  </div>
                  {isAdmin && deletingMemberName === member.name && (
                    <form
                      className="delete-member-form"
                      noValidate
                      onSubmit={(event) => void handleDeleteMember(event, member.name)}
                    >
                      <p>This permanently deletes the member’s login account and savings history.</p>
                      <label>
                        Confirm with your admin password
                        <input
                          autoFocus
                          type="password"
                          required
                          autoComplete="current-password"
                          value={deleteAdminPassword}
                          onChange={(event) => {
                            setDeleteAdminPassword(event.target.value)
                            setDeleteMemberError('')
                          }}
                        />
                      </label>
                      <button type="submit" className="secondary-button" disabled={isDeletingMember}>
                        {isDeletingMember ? 'Deleting…' : 'Confirm delete'}
                      </button>
                      {deleteMemberError && <p className="member-error" role="alert">{deleteMemberError}</p>}
                    </form>
                  )}
                  <div className="savings-member-transactions">
                    <h4>Savings transactions</h4>
                    <ul>
                      {getMemberSavingsTransactions(member).map((transaction) => (
                        <li key={transaction.id}>
                          <div>
                            <strong>{transaction.type}</strong>
                            <small>
                              {formatDate(transaction.date)}
                              {transaction.reason && ` · ${transaction.reason}`}
                            </small>
                          </div>
                          <span className={transaction.amount < 0 ? 'negative' : 'positive'}>
                            {transaction.amount < 0 ? '-' : '+'}{formatCurrency(Math.abs(transaction.amount))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="savings-history-empty">No members match “{memberSearch}”.</p>
          )
        ) : (
          <p className="savings-history-empty">No registered members yet.</p>
        )}
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
  guarantors,
  onAddBorrower,
  onAddBorrowerInterest,
  onPayBorrowerInterest,
  onPayBorrowerPrincipal,
  onAddBorrowerPrincipal,
  onRemoveBorrower,
  totalInterestPaid,
}: {
  borrowers: Borrower[]
  guarantors: string[]
  onAddBorrower: (borrower: Borrower) => void
  onAddBorrowerInterest: (borrowerId: string) => void
  onPayBorrowerInterest: (borrowerId: string, amount: number) => void
  onPayBorrowerPrincipal: (borrowerId: string, amount: number) => void
  onAddBorrowerPrincipal: (borrowerId: string, amount: number) => void
  onRemoveBorrower: (borrowerId: string) => void
  totalInterestPaid: number
}) {
  const [isAddingBorrower, setIsAddingBorrower] = useState(false)
  const [borrowerName, setBorrowerName] = useState('')
  const [guarantorName, setGuarantorName] = useState('')
  const [borrowerLoanAmount, setBorrowerLoanAmount] = useState('')
  const [borrowerError, setBorrowerError] = useState('')
  const [payingBorrowerId, setPayingBorrowerId] = useState<string | null>(null)
  const [interestPaymentAmount, setInterestPaymentAmount] = useState('')
  const [interestPaymentError, setInterestPaymentError] = useState('')
  const [payingPrincipalBorrowerId, setPayingPrincipalBorrowerId] = useState<string | null>(null)
  const [principalPaymentAmount, setPrincipalPaymentAmount] = useState('')
  const [principalPaymentError, setPrincipalPaymentError] = useState('')
  const [addingPrincipalBorrowerId, setAddingPrincipalBorrowerId] = useState<string | null>(null)
  const [principalAdditionAmount, setPrincipalAdditionAmount] = useState('')
  const [principalAdditionError, setPrincipalAdditionError] = useState('')
  const [borrowerSearch, setBorrowerSearch] = useState('')
  const totalLoanProceeds = borrowers.reduce((total, borrower) => total + borrower.loanAmount, 0)
  const totalReceivableInterest = borrowers.reduce((total, borrower) => total + borrower.paydayInterest, 0)
  const filteredBorrowers = borrowers.filter((borrower) =>
    borrower.name.toLowerCase().includes(borrowerSearch.trim().toLowerCase()),
  )
  const loanHistory = borrowers
    .flatMap((borrower) => (borrower.transactions ?? []).map((transaction) => ({
      ...transaction,
      borrowerId: borrower.id,
      borrowerName: borrower.name,
      amount: transaction.type === 'interest-payment' || transaction.type === 'principal-payment'
        ? -transaction.amount
        : transaction.amount,
    })))
    .sort((first, second) => second.date.localeCompare(first.date))
  const handleAddBorrower = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = borrowerName.trim()
    const loanAmount = Number(borrowerLoanAmount)
    if (!name) {
      setBorrowerError('Enter the borrower’s name.')
      return
    }
    if (!guarantorName || !guarantors.includes(guarantorName)) {
      setBorrowerError('Select a registered member as guarantor.')
      return
    }
    if (borrowerLoanAmount === '' || !Number.isFinite(loanAmount) || loanAmount <= 0) {
      setBorrowerError('Enter a loan amount greater than zero.')
      return
    }

    onAddBorrower({
      id: crypto.randomUUID(),
      name,
      guarantorName,
      email: '',
      loanAmount,
      paydayInterest: 0,
      createdAt: new Date().toISOString(),
      transactions: [{
        id: crypto.randomUUID(),
        type: 'loan',
        amount: loanAmount,
        date: getLocalDate(),
      }],
    })
    setBorrowerName('')
    setGuarantorName('')
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

  const handlePayBorrowerPrincipal = (event: FormEvent<HTMLFormElement>, borrower: Borrower) => {
    event.preventDefault()
    const amount = Number(principalPaymentAmount)
    if (principalPaymentAmount === '' || !Number.isFinite(amount) || amount <= 0) {
      setPrincipalPaymentError('Enter an amount greater than zero.')
      return
    }
    const roundedAmount = Number(amount.toFixed(2))
    if (roundedAmount <= 0) {
      setPrincipalPaymentError('Enter an amount of at least 0.01.')
      return
    }
    if (roundedAmount > borrower.loanAmount) {
      setPrincipalPaymentError('Payment cannot exceed the outstanding principal.')
      return
    }

    onPayBorrowerPrincipal(borrower.id, roundedAmount)
    setPayingPrincipalBorrowerId(null)
    setPrincipalPaymentAmount('')
    setPrincipalPaymentError('')
  }

  const handleAddBorrowerPrincipal = (event: FormEvent<HTMLFormElement>, borrower: Borrower) => {
    event.preventDefault()
    const amount = Number(principalAdditionAmount)
    if (principalAdditionAmount === '' || !Number.isFinite(amount) || amount <= 0) {
      setPrincipalAdditionError('Enter an amount greater than zero.')
      return
    }
    const roundedAmount = Number(amount.toFixed(2))
    if (roundedAmount <= 0) {
      setPrincipalAdditionError('Enter an amount of at least 0.01.')
      return
    }

    onAddBorrowerPrincipal(borrower.id, roundedAmount)
    setAddingPrincipalBorrowerId(null)
    setPrincipalAdditionAmount('')
    setPrincipalAdditionError('')
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
        </div>
      </section>

      <section className="panel full-width-panel loan-proceeds-panel">
        <span>Total loan proceeds</span>
        <strong>{formatCurrency(totalLoanProceeds)}</strong>
      </section>

      <section className="panel full-width-panel loan-proceeds-panel loan-interest-panel">
        <span>Total received interest</span>
        <strong>{formatCurrency(totalInterestPaid)}</strong>
      </section>

      <section className="panel full-width-panel loan-proceeds-panel loan-receivable-interest-panel">
        <span>Total receivable interest</span>
        <strong>{formatCurrency(totalReceivableInterest)}</strong>
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
            Guarantor
            <select
              required
              value={guarantorName}
              onChange={(event) => {
                setGuarantorName(event.target.value)
                setBorrowerError('')
              }}
            >
              <option value="">Select a registered member</option>
              {guarantors.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
          <label>
            Initial interest
            <output>{formatCurrency(0)}</output>
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
          {guarantors.length === 0 && (
            <p className="member-error" role="alert">No registered members are available to select as a guarantor.</p>
          )}
          {borrowerError && <p className="member-error" role="alert">{borrowerError}</p>}
        </form>
      )}

      <section className="panel full-width-panel borrower-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Borrowers</p>
            <h3>Borrower directory</h3>
          </div>
          <div className="borrower-directory-controls">
            <input
              className="borrower-search"
              type="search"
              aria-label="Search borrowers"
              value={borrowerSearch}
              onChange={(event) => setBorrowerSearch(event.target.value)}
              placeholder="Search borrowers"
            />
            <span className="meta-pill">{borrowers.length} total</span>
          </div>
        </div>
        {borrowers.length > 0 ? (
          filteredBorrowers.length > 0 ? (
            <ul className="borrower-list">
            {filteredBorrowers.map((borrower) => (
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
                      disabled={borrower.loanAmount <= 0}
                      onClick={() => {
                        setPayingPrincipalBorrowerId((currentId) => currentId === borrower.id ? null : borrower.id)
                        setPrincipalPaymentAmount('')
                        setPrincipalPaymentError('')
                        setPayingBorrowerId(null)
                      }}
                    >
                      Pay principal
                    </button>
                    <button
                      type="button"
                      className="secondary-button borrower-interest-button"
                      onClick={() => {
                        setAddingPrincipalBorrowerId((currentId) => currentId === borrower.id ? null : borrower.id)
                        setPrincipalAdditionAmount('')
                        setPrincipalAdditionError('')
                        setPayingPrincipalBorrowerId(null)
                        setPayingBorrowerId(null)
                      }}
                    >
                      Add principal
                    </button>
                    <button
                      type="button"
                      className="secondary-button borrower-interest-button"
                      disabled={borrower.paydayInterest <= 0}
                      onClick={() => {
                        setPayingBorrowerId((currentId) => currentId === borrower.id ? null : borrower.id)
                        setInterestPaymentAmount('')
                        setInterestPaymentError('')
                        setPayingPrincipalBorrowerId(null)
                      }}
                    >
                      Pay interest
                    </button>
                    <button
                      type="button"
                      className="secondary-button borrower-interest-button"
                      disabled={hasOutstandingBorrowerBalance(borrower.loanAmount) || hasOutstandingBorrowerBalance(borrower.paydayInterest)}
                      onClick={() => onRemoveBorrower(borrower.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="borrower-metrics">
                  {borrower.guarantorName && <span><strong>Guarantor:</strong> {borrower.guarantorName}</span>}
                  <span className="borrower-metric principal-metric"><strong>Principal:</strong> {formatBorrowerCurrency(borrower.loanAmount)}</span>
                  <span className="borrower-metric interest-metric"><strong>Interest:</strong> {formatBorrowerCurrency(borrower.paydayInterest)}</span>
                </div>
                {payingBorrowerId === borrower.id && (
                  <form
                    className="interest-payment-form"
                    noValidate
                    onSubmit={(event) => handlePayBorrowerInterest(event, borrower)}
                  >
                    <label>
                      Payment amount (up to {formatBorrowerCurrency(borrower.paydayInterest)})
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
                {payingPrincipalBorrowerId === borrower.id && (
                  <form
                    className="interest-payment-form"
                    noValidate
                    onSubmit={(event) => handlePayBorrowerPrincipal(event, borrower)}
                  >
                    <label>
                      Payment amount (up to {formatBorrowerCurrency(borrower.loanAmount)})
                      <input
                        type="number"
                        min="0.01"
                        max={borrower.loanAmount}
                        step="any"
                        required
                        value={principalPaymentAmount}
                        onChange={(event) => {
                          setPrincipalPaymentAmount(event.target.value)
                          setPrincipalPaymentError('')
                        }}
                        placeholder="0"
                      />
                    </label>
                    <button type="submit" className="primary-button">Record payment</button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setPayingPrincipalBorrowerId(null)
                        setPrincipalPaymentError('')
                      }}
                    >
                      Cancel
                    </button>
                    {principalPaymentError && <p className="member-error" role="alert">{principalPaymentError}</p>}
                  </form>
                )}
                {addingPrincipalBorrowerId === borrower.id && (
                  <form
                    className="interest-payment-form"
                    noValidate
                    onSubmit={(event) => handleAddBorrowerPrincipal(event, borrower)}
                  >
                    <label>
                      Amount to add
                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        required
                        value={principalAdditionAmount}
                        onChange={(event) => {
                          setPrincipalAdditionAmount(event.target.value)
                          setPrincipalAdditionError('')
                        }}
                        placeholder="0"
                      />
                    </label>
                    <button type="submit" className="primary-button">Add principal</button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setAddingPrincipalBorrowerId(null)
                        setPrincipalAdditionError('')
                      }}
                    >
                      Cancel
                    </button>
                    {principalAdditionError && <p className="member-error" role="alert">{principalAdditionError}</p>}
                  </form>
                )}
                <div className="loan-transactions">
                  <small>Loan transactions</small>
                  {borrower.transactions && borrower.transactions.length > 0 ? (
                    <ul className="loan-transaction-list">
                      {borrower.transactions.map((transaction) => (
                        <li key={transaction.id} className="loan-transaction-item">
                          <span className={`transaction-type ${transaction.type}`}>
                            {transaction.type === 'interest-payment'
                              ? 'Interest paid'
                              : transaction.type === 'principal-payment'
                                ? 'Principal paid'
                                : transaction.type === 'principal-addition'
                                  ? 'Principal added'
                                  : transaction.type === 'interest' ? 'Interest' : 'Loan'}
                          </span>
                          <strong>{transaction.type === 'interest-payment' || transaction.type === 'principal-payment' ? '-' : ''}{formatBorrowerCurrency(transaction.amount)}</strong>
                          <time className="loan-transaction-date">{formatDate(transaction.date)}</time>
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
            <p className="savings-history-empty">No borrowers match “{borrowerSearch}”.</p>
          )
        ) : (
          <p className="savings-history-empty">No borrowers added yet.</p>
        )}
      </section>

      <section className="panel full-width-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Loan History</p>
            <h3>Loan transactions</h3>
          </div>
        </div>
        {loanHistory.length > 0 ? (
          <ul className="transaction-list savings-history-list">
            {loanHistory.map((transaction) => (
              <li key={`${transaction.borrowerId}-${transaction.id}`} className="transaction-item loan-history-item">
                <div>
                  <strong>
                    {transaction.type === 'interest-payment'
                      ? 'Interest paid'
                      : transaction.type === 'principal-payment'
                        ? 'Principal paid'
                        : transaction.type === 'principal-addition'
                          ? 'Principal added'
                          : transaction.type === 'interest' ? 'Interest added' : 'Loan issued'}
                    {' · '}{transaction.borrowerName}
                  </strong>
                  <small>{formatDate(transaction.date)}</small>
                </div>
                <span className={transaction.amount < 0 ? 'negative' : 'positive'}>
                  {transaction.amount < 0 ? '-' : '+'}{formatCurrency(Math.abs(transaction.amount))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="savings-history-empty">No loan transactions yet.</p>
        )}
      </section>

    </main>
  )
}

function ProfitsPage({
  members,
  totalInterestPaid,
  totalReceivableInterest,
  totalGroupAllowance,
  onApplyMemberProfitAction,
}: {
  members: Member[]
  totalInterestPaid: number
  totalReceivableInterest: number
  totalGroupAllowance: number
  onApplyMemberProfitAction: (memberName: string, amount: number, action: 'add to savings' | 'withdraw' | 'penalty') => void
}) {
  const profitsData = [
    { label: 'Net profit', value: formatCurrency(totalInterestPaid), tone: 'positive' },
    { label: 'Total receivable', value: formatCurrency(totalReceivableInterest), tone: 'positive' },
    { label: 'Group allowance', value: formatCurrency(totalGroupAllowance), tone: 'positive' },
    { label: 'Group oprtng cost', value: '₱7,540', tone: 'negative' },
  ]
  const totalSavings = members.reduce((total, member) => total + getMemberSavings(member), 0)
  const memberProfits = members.map((member) => {
    const memberSavings = getMemberSavings(member)
    const sharePercentage = totalSavings > 0 ? (memberSavings / totalSavings) * 100 : 0
    const profitShare = totalInterestPaid > 0 ? (sharePercentage / 100) * totalInterestPaid : 0
    return { member, sharePercentage, profitShare }
  })
  const [memberProfitActions, setMemberProfitActions] = useState<Record<string, 'add to savings' | 'withdraw' | 'penalty'>>({})

  return (
    <main className="page-view">
      <section className="page-header">
        <div>
          <p className="eyebrow">Profits</p>
          <h2>Performance summary</h2>
        </div>
      </section>

      <section className="summary-grid profits-summary-grid">
        {profitsData.map((item) => (
          <article
            key={item.label}
            className={`summary-card ${item.label === 'Net profit' ? 'profits-net-profit-card' : ''}`}
          >
            {item.label === 'Net profit' ? (
              <div className="profits-net-profit-content">
                <p className="profits-net-profit-label">{item.label}</p>
                <h2>{item.value}</h2>
              </div>
            ) : (
              <>
                <p>{item.label}</p>
                <h2>{item.value}</h2>
                <span className={item.tone}>vs last month</span>
              </>
            )}
            {item.label === 'Net profit' && <span className={item.tone}>vs last month</span>}
          </article>
        ))}
      </section>

      <section className="panel full-width-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Members</p>
            <h3>Members Profit</h3>
          </div>
        </div>
        <div className="stats-grid">
          {memberProfits.map(({ member, sharePercentage, profitShare }) => {
            const action = memberProfitActions[member.name] ?? 'add to savings'
            return (
              <div key={member.name} className="stat-box member-profit-box">
                <span>{member.name}</span>
                <strong>{formatCurrency(profitShare)}</strong>
                <small>{sharePercentage.toFixed(1)}% of savings</small>
                <div className="member-profit-actions">
                  <label>
                    Reason
                    <select
                      value={action}
                      onChange={(event) => {
                        const nextAction = event.target.value as 'add to savings' | 'withdraw' | 'penalty'
                        setMemberProfitActions((current) => ({ ...current, [member.name]: nextAction }))
                      }}
                    >
                      <option value="add to savings">Add to savings</option>
                      <option value="withdraw">Withdraw</option>
                      <option value="penalty">Penalty</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="secondary-button member-profit-deduct-button"
                    onClick={() => onApplyMemberProfitAction(member.name, profitShare, action)}
                  >
                    Deduct
                  </button>
                </div>
              </div>
            )
          })}
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
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [isRegisterMode, setIsRegisterMode] = useState(false)
  const [loginMessage, setLoginMessage] = useState('')
  const [members, setMembers] = useState<Member[]>(loadSavedMembers)
  const [accounts, setAccounts] = useState<DatabaseAccount[]>([])
  const [borrowers, setBorrowers] = useState<Borrower[]>([])
  const [removedBorrowerTransactions, setRemovedBorrowerTransactions] = useState<RemovedBorrowerTransaction[]>([])
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
  const initialRemovedBorrowerTransactions = useRef(removedBorrowerTransactions)
  const totalSavings = members.reduce((total, member) => total + getMemberSavings(member), 0)
  const totalLoanProceeds = borrowers.reduce((total, borrower) => total + borrower.loanAmount, 0)
  const totalInterestPaid = getTotalInterestPaid(borrowers, removedBorrowerTransactions)
  const totalReceivableInterest = borrowers.reduce((total, borrower) => total + borrower.paydayInterest, 0)
  const totalGroupAllowance = members.reduce((total, member) => total + member.withdrawals.reduce(
    (memberTotal, withdrawal) => memberTotal + withdrawal.amount * 0.1,
    0,
  ), 0)
  const registeredGuarantors = accounts
    .flatMap((account) => {
      const email = account.email.trim().toLowerCase()
      const member = members.find((candidate) => candidate.accountEmail?.trim().toLowerCase() === email)
      return member ? [member.name] : []
    })
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
          setRemovedBorrowerTransactions(workbookData.removedBorrowerTransactions)
        } else {
          await writeWorkbookData(directory, initialMembers.current, initialAccounts.current, initialBorrowers.current, initialRemovedBorrowerTransactions.current)
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
        await writeWorkbookData(directory, members, accounts, borrowers, removedBorrowerTransactions)
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
  }, [members, accounts, borrowers, removedBorrowerTransactions])

  const handleChooseDatabaseFolder = async () => {
    setIsDatabaseConnecting(true)
    try {
      const directory = await chooseDatabaseDirectory()
      const workbookData = await readWorkbookData(directory)
      let connectedMembers = members
      let connectedAccounts = accounts
      let connectedBorrowers = borrowers
      let connectedRemovedBorrowerTransactions = removedBorrowerTransactions
      if (workbookData) {
        connectedMembers = syncAccountMembers(workbookData.accounts, workbookData.members)
        connectedAccounts = workbookData.accounts
        connectedBorrowers = workbookData.borrowers
        connectedRemovedBorrowerTransactions = workbookData.removedBorrowerTransactions
      } else {
        await writeWorkbookData(directory, connectedMembers, connectedAccounts, connectedBorrowers, connectedRemovedBorrowerTransactions)
      }
      await saveDirectory(directory)
      databaseDirectory.current = directory
      setMembers(connectedMembers)
      setAccounts(connectedAccounts)
      setBorrowers(connectedBorrowers)
      setRemovedBorrowerTransactions(connectedRemovedBorrowerTransactions)
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
      const savedRemovedBorrowerTransactions = workbookData?.removedBorrowerTransactions ?? removedBorrowerTransactions
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
        await writeWorkbookData(directory, updatedMembers, updatedAccounts, savedBorrowers, savedRemovedBorrowerTransactions)
        setMembers(updatedMembers)
        setAccounts(updatedAccounts)
        setBorrowers(savedBorrowers)
        setRemovedBorrowerTransactions(savedRemovedBorrowerTransactions)
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
        setRemovedBorrowerTransactions(savedRemovedBorrowerTransactions)
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

  const applyMemberProfitAction = (
    memberName: string,
    amount: number,
    action: 'add to savings' | 'withdraw' | 'penalty',
  ) => {
    const date = getLocalDate()
    if (action === 'add to savings') {
      addSavings(memberName, amount, date)
      return
    }

    const reason = action === 'withdraw'
      ? 'Member profit withdrawal'
      : 'Profit penalty'
    pullOutSavings(memberName, amount, date, reason)
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

  const deleteSavingsMember = async (memberName: string, adminPassword: string) => {
    if (signedInRole !== 'admin') {
      return { success: false, message: 'Only an admin can delete a member.' }
    }
    const memberToDelete = members.find((member) => member.name === memberName)
    if (!memberToDelete) {
      return { success: false, message: 'This member is no longer in the directory.' }
    }
    const adminAccount = accounts.find((account) =>
      account.role === 'admin'
      && account.email.trim().toLowerCase() === signedInEmail.trim().toLowerCase(),
    )
    if (!adminAccount) {
      return { success: false, message: 'The logged-in admin account could not be verified.' }
    }
    if (!(await verifyPassword(adminPassword, adminAccount))) {
      return { success: false, message: 'The admin password is incorrect.' }
    }

    const memberEmail = memberToDelete.accountEmail?.trim().toLowerCase()
    const linkedAccount = accounts.find((account) => memberEmail
      ? account.email.trim().toLowerCase() === memberEmail
      : account.name.trim().toLowerCase() === memberToDelete.name.trim().toLowerCase(),
    )
    if (linkedAccount?.email.trim().toLowerCase() === adminAccount.email.trim().toLowerCase()) {
      return { success: false, message: 'You cannot delete the currently signed-in admin account.' }
    }

    setMembers((currentMembers) => currentMembers.filter((member) => member.name !== memberName))
    if (linkedAccount) {
      setAccounts((currentAccounts) => currentAccounts.filter((account) =>
        account.email.trim().toLowerCase() !== linkedAccount.email.trim().toLowerCase(),
      ))
    }
    if (selectedMember === memberName) setSelectedMember('all')
    return { success: true }
  }

  const addBorrower = (borrower: Borrower) => {
    if (signedInRole !== 'admin') return
    setBorrowers((currentBorrowers) => [...currentBorrowers, borrower])
  }

  const removeBorrower = (borrowerId: string) => {
    if (signedInRole !== 'admin') return
    const borrowerToRemove = borrowers.find((borrower) => borrower.id === borrowerId)
    if (!borrowerToRemove
      || hasOutstandingBorrowerBalance(borrowerToRemove.loanAmount)
      || hasOutstandingBorrowerBalance(borrowerToRemove.paydayInterest)) return
    setRemovedBorrowerTransactions((currentTransactions) => [
      ...currentTransactions,
      ...(borrowerToRemove.transactions ?? []).map((transaction) => ({
        borrowerId: borrowerToRemove.id,
        borrowerName: borrowerToRemove.name,
        transaction,
      })),
    ])
    setBorrowers((currentBorrowers) => currentBorrowers.filter((borrower) =>
      borrower.id !== borrowerId
      || hasOutstandingBorrowerBalance(borrower.loanAmount)
      || hasOutstandingBorrowerBalance(borrower.paydayInterest),
    ))
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

  const payBorrowerPrincipal = (borrowerId: string, amount: number) => {
    if (signedInRole !== 'admin' || !Number.isFinite(amount) || amount <= 0) return
    setBorrowers((currentBorrowers) => currentBorrowers.map((borrower) => {
      if (borrower.id !== borrowerId || amount > borrower.loanAmount) return borrower
      const remainingPrincipal = Number((borrower.loanAmount - amount).toFixed(2))
      const nextTransaction = {
        id: crypto.randomUUID(),
        type: 'principal-payment' as const,
        amount,
        date: getLocalDate(),
      }
      return {
        ...borrower,
        loanAmount: Math.max(0, remainingPrincipal),
        transactions: [...(borrower.transactions ?? []), nextTransaction],
      }
    }))
  }

  const addBorrowerPrincipal = (borrowerId: string, amount: number) => {
    if (signedInRole !== 'admin' || !Number.isFinite(amount) || amount <= 0) return
    setBorrowers((currentBorrowers) => currentBorrowers.map((borrower) => {
      if (borrower.id !== borrowerId) return borrower
      const updatedLoanAmount = Number((borrower.loanAmount + amount).toFixed(2))
      if (!Number.isFinite(updatedLoanAmount)) return borrower
      const nextTransaction = {
        id: crypto.randomUUID(),
        type: 'principal-addition' as const,
        amount,
        date: getLocalDate(),
      }
      return {
        ...borrower,
        loanAmount: updatedLoanAmount,
        transactions: [...(borrower.transactions ?? []), nextTransaction],
      }
    }))
  }

  const renderPage = () => {
    if (signedInRole !== 'admin') {
      if (activeTab === 'overview') {
        return <OverviewPage
          totalSavings={totalSavings}
          totalLoanProceeds={totalLoanProceeds}
          totalInterestPaid={totalInterestPaid}
        />
      }
      if (activeTab === 'savings') {
        return (
          <SavingsPage
            members={signedInMember ? [signedInMember] : []}
            borrowers={borrowers}
            selectedMember={signedInMember?.name ?? ''}
            isAdmin={false}
            canEditSavings={Boolean(signedInMember)}
            overallSavings={totalSavings}
            onMemberChange={() => undefined}
            onAddSavings={addSavings}
            onPullOutSavings={pullOutSavings}
            onDeleteMember={deleteSavingsMember}
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
            borrowers={borrowers}
            selectedMember={selectedMember}
            overallSavings={totalSavings}
            isAdmin
            canEditSavings
            onMemberChange={setSelectedMember}
            onAddSavings={addSavings}
            onPullOutSavings={pullOutSavings}
            onDeleteMember={deleteSavingsMember}
          />
        )
      case 'loans':
        return (
          <LoansPage
            borrowers={borrowers}
            guarantors={registeredGuarantors}
            onAddBorrower={addBorrower}
            onAddBorrowerInterest={addBorrowerInterest}
            onPayBorrowerInterest={payBorrowerInterest}
            onPayBorrowerPrincipal={payBorrowerPrincipal}
            onAddBorrowerPrincipal={addBorrowerPrincipal}
            onRemoveBorrower={removeBorrower}
            totalInterestPaid={totalInterestPaid}
          />
        )
      case 'profits':
        return <ProfitsPage
          members={members}
          totalInterestPaid={totalInterestPaid}
          totalReceivableInterest={totalReceivableInterest}
          totalGroupAllowance={totalGroupAllowance}
          onApplyMemberProfitAction={applyMemberProfitAction}
        />
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
        return <OverviewPage
          totalSavings={totalSavings}
          totalLoanProceeds={totalLoanProceeds}
          totalInterestPaid={totalInterestPaid}
        />
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
