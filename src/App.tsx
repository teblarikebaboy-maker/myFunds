import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  chooseDatabaseDirectory,
  createPasswordHash,
  loadSavedDirectory,
  loadSavedDeletedProfitTransactions,
  loadSavedDeletedLoans,
  loadSavedDeletedSavingsTransactions,
  loadSavedMembers,
  loadSavedOtherProfits,
  loadSavedProfitCashouts,
  readWorkbookData,
  saveDirectory,
  saveDeletedProfitTransactionsLocally,
  saveDeletedLoansLocally,
  saveDeletedSavingsTransactionsLocally,
  saveMembersLocally,
  saveOtherProfitsLocally,
  saveProfitCashoutsLocally,
  supportsDatabaseFolder,
  verifyPassword,
  writeWorkbookData,
  type AccountRole,
  type Borrower,
  type DatabaseAccount,
  type DatabaseDirectoryHandle,
  type DeletedLoanRecord,
  type DeletedProfitTransaction,
  type DeletedSavingsTransaction,
  type Member,
  type OtherProfit,
  type ProfitCashout,
  type ProfitTransfer,
  type RemovedBorrowerTransaction,
} from './database'
import './App.css'

type TabKey = 'overview' | 'savings' | 'loans' | 'profits' | 'data' | 'group-update'
type BorrowerDirectoryFilter = 'all' | 'active' | 'paid'
type ChartStyle = 'bar' | 'line'
type GroupAnnouncement = { id: string; title: string; message: string; date: string }
type SavingsTransaction = {
  id: string
  member: string
  type: string
  amount: number
  date: string
  reason?: string
  recordedBy?: string
  fee?: number
  previousAmount?: number
  newAmount?: number
}
type TransactionUndoSnapshot = {
  members: Member[]
  accounts: DatabaseAccount[]
  borrowers: Borrower[]
  removedBorrowerTransactions: RemovedBorrowerTransaction[]
  profitTransfers: ProfitTransfer[]
  otherProfits: OtherProfit[]
  profitCashouts: ProfitCashout[]
}
const getSavingsAdjustmentTotal = (member: Member) =>
  (member.adjustments ?? []).reduce(
    (total, adjustment) => total + adjustment.newAmount - adjustment.previousAmount,
    0,
  )

const getMemberSavings = (member: Member) =>
  member.initialSavings
  + member.contributions.reduce((total, contribution) => total + contribution.amount, 0)
  - member.withdrawals.reduce((total, withdrawal) => total + withdrawal.amount, 0)
  + getSavingsAdjustmentTotal(member)

const getMemberProfitShareSavings = (member: Member) =>
  Math.max(0, member.initialSavings
    + member.contributions
      .filter((contribution) => contribution.source !== 'member profit')
      .reduce((total, contribution) => total + contribution.amount, 0)
    - member.withdrawals.reduce((total, withdrawal) => total + withdrawal.amount, 0)
    + getSavingsAdjustmentTotal(member))

const getMemberProfitShares = (
  members: Member[],
  profitCashouts: ProfitCashout[],
  distributedProfitTotal: number,
) => {
  const totalSavings = members.reduce((total, member) => total + getMemberProfitShareSavings(member), 0)
  const settledTransfersByMember = new Map<string, number>()
  const legacyCashoutsByMember = new Map<string, number>()
  const encoderDeductionsByMember = new Map<string, number>()
  profitCashouts.forEach((cashout) => {
    if (cashout.action !== 'penalty' && cashout.action !== 'encoder' && cashout.transferTotal !== undefined) {
      settledTransfersByMember.set(
        cashout.memberName,
        Math.max(settledTransfersByMember.get(cashout.memberName) ?? 0, cashout.transferTotal),
      )
    }
  })
  profitCashouts.forEach((cashout) => {
    if (cashout.action === 'encoder') {
      const settledTransfers = settledTransfersByMember.get(cashout.memberName)
      if (cashout.transferTotal === undefined
        ? settledTransfers === undefined
        : settledTransfers === undefined || cashout.transferTotal > settledTransfers) {
        encoderDeductionsByMember.set(
          cashout.memberName,
          (encoderDeductionsByMember.get(cashout.memberName) ?? 0) + cashout.amount,
        )
      }
    }
  })
  const penaltyDeductionsByMember = new Map<string, number>()
  profitCashouts.forEach((cashout) => {
    if (cashout.action === 'penalty') {
      const settledTransfers = settledTransfersByMember.get(cashout.memberName)
      if (cashout.transferTotal === undefined
        ? settledTransfers === undefined
        : settledTransfers === undefined || cashout.transferTotal > settledTransfers) {
        penaltyDeductionsByMember.set(
          cashout.memberName,
          (penaltyDeductionsByMember.get(cashout.memberName) ?? 0) + cashout.amount,
        )
      }
    } else if (cashout.transferTotal === undefined
      && cashout.action !== 'added to savings'
      && cashout.action !== 'encoder') {
      legacyCashoutsByMember.set(
        cashout.memberName,
        (legacyCashoutsByMember.get(cashout.memberName) ?? 0) + cashout.amount,
      )
    }
  })
  return members.map((member) => {
    const memberSavings = getMemberProfitShareSavings(member)
    const sharePercentage = totalSavings > 0 ? (memberSavings / totalSavings) * 100 : 0
    const settledTransfers = settledTransfersByMember.get(member.name)
    const eligibleTransfers = settledTransfers === undefined
      ? distributedProfitTotal
      : Math.max(0, distributedProfitTotal - settledTransfers)
    const grossProfitShare = distributedProfitTotal > 0 ? (sharePercentage / 100) * eligibleTransfers : 0
    const legacyCashouts = settledTransfers === undefined ? legacyCashoutsByMember.get(member.name) ?? 0 : 0
    const penaltyDeductions = penaltyDeductionsByMember.get(member.name) ?? 0
    const encoderDeductions = encoderDeductionsByMember.get(member.name) ?? 0
    const profitShare = Number(Math.max(0, grossProfitShare - legacyCashouts - penaltyDeductions - encoderDeductions).toFixed(2))
    return { member, sharePercentage, profitShare }
  })
}

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
    type: contribution.source === 'member profit' ? 'Profit added to savings' : 'Added savings',
    amount: contribution.amount,
    date: contribution.date,
    recordedBy: contribution.recordedBy,
  })),
  ...member.withdrawals.map((withdrawal, index) => ({
    id: `${member.name}-withdrawal-${index}`,
    member: member.name,
    type: 'Pull out savings',
    amount: -withdrawal.amount,
    date: withdrawal.date,
    reason: withdrawal.reason,
    recordedBy: withdrawal.recordedBy,
    fee: withdrawal.amount * 0.1,
  })),
  ...(member.adjustments ?? []).map((adjustment) => ({
    id: adjustment.id,
    member: member.name,
    type: 'Savings adjustment',
    amount: adjustment.newAmount - adjustment.previousAmount,
    date: adjustment.date,
    reason: adjustment.reason,
    previousAmount: adjustment.previousAmount,
    newAmount: adjustment.newAmount,
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
      adjustments: [],
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

type OverviewCashOutTransaction = {
  id: string
  name: string
  type: string
  amount: number
  date: string
  reason?: string
  recordedBy?: string
  previousAmount?: number
  newAmount?: number
}

const getOverviewCashOutTransactions = (
  members: Member[],
  borrowers: Borrower[],
  profitCashouts: ProfitCashout[],
): OverviewCashOutTransaction[] => [
  ...profitCashouts
    .filter((cashout) => cashout.action === 'cashout' || cashout.action === undefined)
    .map((cashout, index) => ({
      id: `profit-${cashout.memberName}-${cashout.date}-${index}`,
      name: cashout.memberName,
      type: 'Get profit',
      amount: cashout.amount,
      date: cashout.date,
    })),
  ...borrowers.flatMap((borrower) => (borrower.transactions ?? [])
    .filter((transaction) => transaction.type === 'loan' || transaction.type === 'principal-addition')
    .map((transaction) => ({
      id: `${borrower.id}-${transaction.id}`,
      name: borrower.name,
      type: transaction.type === 'loan' ? 'Loan amount' : 'Add principal',
      amount: transaction.amount,
      date: transaction.date,
    }))),
  ...members.flatMap((member) => member.withdrawals.map((withdrawal, index) => ({
    id: `withdrawal-${member.name}-${withdrawal.date}-${index}`,
    name: member.name,
    type: 'Pull-out',
    amount: withdrawal.amount,
    date: withdrawal.date,
    recordedBy: withdrawal.recordedBy,
  }))),
  ...members.flatMap((member) => (member.adjustments ?? [])
    .filter((adjustment) => adjustment.newAmount < adjustment.previousAmount)
    .map((adjustment) => ({
      id: `adjustment-${member.name}-${adjustment.id}`,
      name: member.name,
      type: 'Savings adjustment',
      amount: adjustment.previousAmount - adjustment.newAmount,
      date: adjustment.date,
      reason: adjustment.reason,
      previousAmount: adjustment.previousAmount,
      newAmount: adjustment.newAmount,
    }))),
].sort((first, second) => second.date.localeCompare(first.date))

type OverviewCashInTransaction = {
  id: string
  name: string
  type: string
  amount: number
  date: string
  reason?: string
  recordedBy?: string
  previousAmount?: number
  newAmount?: number
}

const getOverviewCashInTransactions = (
  members: Member[],
  borrowers: Borrower[],
  removedTransactions: RemovedBorrowerTransaction[],
  otherProfits: OtherProfit[],
): OverviewCashInTransaction[] => [
  ...otherProfits.map((profit) => ({
    id: `other-profit-${profit.id}`,
    name: profit.source,
    type: 'Other profit',
    amount: profit.amount,
    date: profit.date,
  })),
  ...members
    .filter((member) => member.initialSavings > 0)
    .map((member) => ({
      id: `initial-savings-${member.name}`,
      name: member.name,
      type: 'Initial savings',
      amount: member.initialSavings,
      date: member.initialSavingsDate,
    })),
  ...members.flatMap((member) => member.contributions.map((contribution, index) => ({
    id: `savings-${member.name}-${contribution.date}-${index}`,
    name: member.name,
    type: contribution.source === 'member profit' ? 'Profit added to savings' : 'Add savings',
    amount: contribution.amount,
    date: contribution.date,
    recordedBy: contribution.recordedBy,
  }))),
  ...members.flatMap((member) => (member.adjustments ?? [])
    .filter((adjustment) => adjustment.newAmount > adjustment.previousAmount)
    .map((adjustment) => ({
      id: `adjustment-${member.name}-${adjustment.id}`,
      name: member.name,
      type: 'Savings adjustment',
      amount: adjustment.newAmount - adjustment.previousAmount,
      date: adjustment.date,
      reason: adjustment.reason,
      previousAmount: adjustment.previousAmount,
      newAmount: adjustment.newAmount,
    }))),
  ...borrowers.flatMap((borrower) => (borrower.transactions ?? [])
    .filter((transaction) => transaction.type === 'interest-payment' || transaction.type === 'principal-payment')
    .map((transaction) => ({
      id: `${borrower.id}-${transaction.id}`,
      name: borrower.name,
      type: transaction.type === 'interest-payment' ? 'Pay interest' : 'Pay principal',
      amount: transaction.amount,
      date: transaction.date,
    }))),
  ...removedTransactions
    .filter(({ transaction }) =>
      transaction.type === 'interest-payment' || transaction.type === 'principal-payment',
    )
    .map(({ borrowerId, borrowerName, transaction }) => ({
      id: `${borrowerId}-${transaction.id}`,
      name: borrowerName,
      type: transaction.type === 'interest-payment' ? 'Pay interest' : 'Pay principal',
      amount: transaction.amount,
      date: transaction.date,
    })),
].sort((first, second) => second.date.localeCompare(first.date))

const homeDownPaymentTarget = 30000

const savingsPlans = [
  { name: 'Home down payment', value: '₱15,600', target: '₱30,000', rate: 52 },
]

const tabs: Array<{ id: TabKey; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'savings', label: 'Savings' },
  { id: 'loans', label: 'Loans' },
  { id: 'profits', label: 'Profits' },
  { id: 'group-update', label: 'Group Update' },
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

const downloadWorkbook = async (
  filename: string,
  buildWorkbook: (workbook: import('exceljs').Workbook) => void,
) => {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Funds Organizer'
  buildWorkbook(workbook)
  const buffer = await workbook.xlsx.writeBuffer()
  const downloadUrl = URL.createObjectURL(new Blob([buffer as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = filename
  link.click()
  URL.revokeObjectURL(downloadUrl)
}

const currentYear = new Date().getFullYear()
const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const getMonthlyNetProfit = (
  borrowers: Borrower[],
  removedTransactions: RemovedBorrowerTransaction[],
  otherProfits: OtherProfit[],
  year: number,
) => {
  const monthlyTotals = Array.from({ length: 12 }, () => 0)
  const interestPayments = [
    ...borrowers.flatMap((borrower) => borrower.transactions ?? []),
    ...removedTransactions.map(({ transaction }) => transaction),
  ]

  interestPayments.forEach((transaction) => {
    if (transaction.type !== 'interest-payment' || !transaction.date.startsWith(`${year}-`)) return
    const month = Number(transaction.date.slice(5, 7)) - 1
    if (month >= 0 && month < monthlyTotals.length) monthlyTotals[month] += transaction.amount
  })

  otherProfits.forEach((profit) => {
    if (!profit.date.startsWith(`${year}-`)) return
    const month = Number(profit.date.slice(5, 7)) - 1
    if (month >= 0 && month < monthlyTotals.length) monthlyTotals[month] += profit.amount
  })

  return monthLabels.map((month, index) => ({ month, value: monthlyTotals[index] }))
}

function OverviewPage({
  totalSavings,
  totalLoanProceeds,
  totalInterestPaid,
  totalOtherProfit,
  monthlyNetProfit,
  cashInTransactions,
  cashOutTransactions,
}: {
  totalSavings: number
  totalLoanProceeds: number
  totalInterestPaid: number
  totalOtherProfit: number
  monthlyNetProfit: Array<{ month: string; value: number }>
  cashInTransactions: OverviewCashInTransaction[]
  cashOutTransactions: OverviewCashOutTransaction[]
}) {
  const [chartStyle, setChartStyle] = useState<ChartStyle>('bar')
  const [isChartStyleMenuOpen, setIsChartStyleMenuOpen] = useState(false)
  const [{ data: groupUpdateData, error: groupUpdateError }] = useState(loadGroupUpdateData)
  const meetingDate = groupUpdateData.meetingSchedule ? new Date(groupUpdateData.meetingSchedule) : null
  const meetingSchedule = meetingDate && !Number.isNaN(meetingDate.getTime())
    ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(meetingDate)
    : ''
  const meetingMapUrl = groupUpdateData.meetingPlace.trim()
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(groupUpdateData.meetingPlace.trim())}`
    : ''
  const maxMonthlyProfit = Math.max(1, ...monthlyNetProfit.map((month) => month.value))
  const chartPoints = monthlyNetProfit.map((month, index) => ({
    x: 20 + (index / (monthlyNetProfit.length - 1)) * 1060,
    y: 90 - (month.value / maxMonthlyProfit) * 76,
  }))
  const chartPath = chartPoints.slice(1).reduce((path, point) => {
    return `${path} L ${point.x} ${point.y}`
  }, `M ${chartPoints[0].x} ${chartPoints[0].y}`)
  const selectedChartStyle = chartStyles.find((style) => style.value === chartStyle)!

  return (
    <main className="dashboard">
      <section className="summary-grid" aria-label="Summary cards">
        {summaryCards.map((card) => (
          <article key={card.label} className={`summary-card overview-summary-card ${card.tone}`}>
            <p>{card.label}</p>
            <h2>
              {card.label === 'Available funds'
                ? formatCurrency(totalSavings - totalLoanProceeds)
                : card.label === 'Total Savings'
                  ? formatCurrency(totalSavings)
                  : card.label === 'Loans Proceeds'
                    ? formatCurrency(totalLoanProceeds)
                    : card.label === 'Total Profits'
                      ? formatCurrency(totalInterestPaid + totalOtherProfit)
                      : card.value}
            </h2>
            <span className={card.tone}>{card.delta}</span>
          </article>
        ))}
      </section>

      <section className="content-grid">
        <article className="panel chart-panel overview-chart-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">NET PROFIT</p>
              <h3>Monthly Net Profit</h3>
            </div>
            <button type="button" className="secondary-button">{currentYear}</button>
          </div>

          <div className={`chart chart-${chartStyle}`} aria-label="Monthly net profit trend">
            {chartStyle === 'bar' ? (
              monthlyNetProfit.map((month) => (
                <div key={month.month} className="bar-group">
                  <div
                    className="bar-track"
                    role="img"
                    aria-label={`${month.month}: ${formatCurrency(month.value)} net profit`}
                    tabIndex={0}
                  >
                    <div
                      className="bar-fill"
                      data-value={formatCurrency(month.value)}
                      style={{ height: `${(month.value / maxMonthlyProfit) * 100}%` }}
                    />
                  </div>
                  <span>{month.month}</span>
                </div>
              ))
            ) : (
              <>
                <div className="chart-plot">
                  <svg className="chart-line-svg" viewBox="0 0 1100 100" preserveAspectRatio="none" aria-hidden="true">
                    <path className="chart-line-path" d={chartPath} />
                    {chartPoints.map((point, index) => (
                      <circle key={monthlyNetProfit[index].month} className="chart-line-dot" cx={point.x} cy={point.y} r="5" />
                    ))}
                  </svg>
                  {monthlyNetProfit.map((month, index) => (
                    <div
                      key={month.month}
                      className="chart-point"
                      role="img"
                      aria-label={`${month.month}: ${formatCurrency(month.value)} net profit`}
                      data-value={formatCurrency(month.value)}
                      style={{
                        left: `${(index / (monthlyNetProfit.length - 1)) * 100}%`,
                        bottom: `${5 + (month.value / maxMonthlyProfit) * 80}%`,
                      }}
                      tabIndex={0}
                    />
                  ))}
                </div>
                <div className="chart-months" aria-hidden="true">
                  {monthlyNetProfit.map((month) => <span key={month.month}>{month.month}</span>)}
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

        <article className="panel snapshot-panel overview-snapshot-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Group Update</p>
              <h3>Announcements</h3>
            </div>
          </div>

          {groupUpdateData.announcements.length > 0 ? (
            <ul className="overview-announcement-list">
              {groupUpdateData.announcements.map((announcement) => (
                <li key={announcement.id} className="overview-announcement">
                  <div className="account-meta">
                    <strong>{announcement.title}</strong>
                    <time dateTime={announcement.date}>{formatDate(announcement.date)}</time>
                  </div>
                  <p>{announcement.message}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="overview-announcement-empty">
              {groupUpdateError || 'No group announcements yet.'}
            </p>
          )}

          <section className="overview-meeting" aria-label="Meeting details">
            <div className="overview-meeting-header">
              <p className="eyebrow">Group Update</p>
              <h4>Meeting schedule and details</h4>
            </div>
            {groupUpdateError ? (
              <p className="overview-meeting-empty">{groupUpdateError}</p>
            ) : groupUpdateData.meetingSchedule || groupUpdateData.meetingPlace || groupUpdateData.meetingPenalty > 0 ? (
              <dl className="overview-meeting-details">
                <div>
                  <dt>Schedule</dt>
                  <dd>{meetingSchedule || 'Schedule unavailable'}</dd>
                </div>
                <div>
                  <dt>Place</dt>
                  <dd>
                    {groupUpdateData.meetingPlace || 'Not set'}
                    {meetingMapUrl && (
                      <a href={meetingMapUrl} target="_blank" rel="noreferrer">Open map</a>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Penalty for not attending</dt>
                  <dd>{formatCurrency(groupUpdateData.meetingPenalty)}</dd>
                </div>
              </dl>
            ) : (
              <p className="overview-meeting-empty">No meeting details set.</p>
            )}
          </section>
        </article>
      </section>

      <section className="detail-grid">
        <article className="panel overview-cash-in-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">CASH-IN</p>
              <h3>Transactions</h3>
            </div>
            <span className="meta-pill">All transactions</span>
          </div>

          {cashInTransactions.length > 0 ? (
            <ul className="transaction-list overview-transaction-list">
              {cashInTransactions.map((transaction) => (
                <li key={transaction.id} className="transaction-item">
                  <div>
                    <strong>{transaction.name} · {transaction.type}</strong>
                    <small>
                      {formatDate(transaction.date)}
                      {transaction.recordedBy && ` · Logged by ${transaction.recordedBy}`}
                      {transaction.reason && ` · ${transaction.reason}`}
                      {transaction.previousAmount !== undefined && transaction.newAmount !== undefined
                        && ` · From ${formatCurrency(transaction.previousAmount)} to ${formatCurrency(transaction.newAmount)}`}
                    </small>
                  </div>
                  <span className="positive">+{formatBorrowerCurrency(transaction.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="savings-history-empty">No cash-in transactions yet.</p>
          )}
        </article>

        <article className="panel side-panel overview-cash-out-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">CASH-OUT</p>
              <h3>Transactions</h3>
            </div>
          </div>

          {cashOutTransactions.length > 0 ? (
            <ul className="bill-list overview-transaction-list">
              {cashOutTransactions.map((transaction) => (
                <li key={transaction.id} className="bill-item">
                  <div>
                    <strong>{transaction.name} · {transaction.type}</strong>
                    <small>
                      {formatDate(transaction.date)}
                      {transaction.recordedBy && ` · Logged by ${transaction.recordedBy}`}
                      {transaction.reason && ` · ${transaction.reason}`}
                      {transaction.previousAmount !== undefined && transaction.newAmount !== undefined
                        && ` · From ${formatCurrency(transaction.previousAmount)} to ${formatCurrency(transaction.newAmount)}`}
                    </small>
                  </div>
                  <span className="negative">-{formatBorrowerCurrency(transaction.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="savings-history-empty">No cash-out transactions yet.</p>
          )}

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
  onEditMemberSavings: (memberName: string, amount: number, reason: string, date: string) => void
  onAddMember: (name: string, initialSavings: number, initialSavingsDate: string, email: string, password: string) => Promise<{ success: boolean; message?: string }>
  onDeleteMember: (memberName: string, adminPassword: string) => Promise<{ success: boolean; message?: string }>
  onClearSavingsTransactions: (adminPassword: string, confirmationText: string) => Promise<{ success: boolean; message?: string }>
}

function AddMemberSavingsForm({
  memberName,
  onAddSavings,
}: {
  memberName: string
  onAddSavings: (memberName: string, amount: number, date: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(getLocalDate)
  const [error, setError] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedAmount = Number(amount)

    if (amount === '' || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Enter a savings amount greater than zero.')
      return
    }

    if (!date) {
      setError('Choose a date for this savings entry.')
      return
    }

    onAddSavings(memberName, parsedAmount, date)
    setAmount('')
    setDate(getLocalDate())
    setError('')
    setIsOpen(false)
  }

  return (
    <div className="savings-member-actions">
      {!isOpen ? (
        <button type="button" className="primary-button" onClick={() => setIsOpen(true)}>
          Add savings
        </button>
      ) : (
        <form className="add-savings-form" noValidate onSubmit={handleSubmit}>
          <label>
            Amount (PHP)
            <input
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
                setError('')
              }}
              placeholder="0"
            />
          </label>
          <label>
            Date
            <input
              type="date"
              required
              value={date}
              onChange={(event) => {
                setDate(event.target.value)
                setError('')
              }}
            />
          </label>
          <button type="submit" className="primary-button">
            Save savings
          </button>
          <button type="button" className="secondary-button" onClick={() => {
            setIsOpen(false)
            setError('')
          }}>
            Cancel
          </button>
          {error && <p className="member-error" role="alert">{error}</p>}
        </form>
      )}
    </div>
  )
}

function PullOutMemberSavingsForm({
  member,
  onPullOutSavings,
}: {
  member: Member
  onPullOutSavings: (memberName: string, amount: number, date: string, reason: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(getLocalDate)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const parsedAmount = Number(amount)
  const fee = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount * 0.1 : 0
  const savingsInCents = Math.max(0, Math.round(getMemberSavings(member) * 100))

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (amount === '' || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Enter a pull-out amount greater than zero.')
      return
    }

    const amountInCents = Math.round(parsedAmount * 100)
    if (amountInCents <= 0) {
      setError('Enter a pull-out amount of at least one cent.')
      return
    }

    if (amountInCents > savingsInCents) {
      setError('The pull-out amount cannot exceed this member’s savings.')
      return
    }

    if (!date || !reason.trim()) {
      setError('Enter a date and reason for the pull-out.')
      return
    }

    onPullOutSavings(member.name, amountInCents / 100, date, reason.trim())
    setAmount('')
    setDate(getLocalDate())
    setReason('')
    setError('')
    setIsOpen(false)
  }

  return (
    <div className="savings-member-actions">
      {!isOpen ? (
        <button type="button" className="secondary-button" onClick={() => setIsOpen(true)}>
          Pull out savings
        </button>
      ) : (
        <form className="pull-out-form" noValidate onSubmit={handleSubmit}>
          <label>
            Amount (PHP)
            <input
              type="number"
              min="0"
              max={savingsInCents / 100}
              step="0.01"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
                setError('')
              }}
              placeholder="0"
            />
          </label>
          <label>
            Date
            <input
              type="date"
              required
              value={date}
              onChange={(event) => {
                setDate(event.target.value)
                setError('')
              }}
            />
          </label>
          <label>
            Reason
            <input
              type="text"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                setError('')
              }}
              placeholder="Reason for pull-out"
            />
          </label>
          <div className="withdrawal-summary">
            <span>10% deduction: {formatCurrency(fee)}</span>
            <strong>Payout: {formatCurrency(Math.max(parsedAmount - fee, 0))}</strong>
            <small>Available: {formatBorrowerCurrency(getMemberSavings(member))}</small>
          </div>
          <button type="submit" className="secondary-button">
            Confirm pull-out
          </button>
          <button type="button" className="secondary-button" onClick={() => {
            setIsOpen(false)
            setError('')
          }}>
            Cancel
          </button>
          {error && <p className="member-error" role="alert">{error}</p>}
        </form>
      )}
    </div>
  )
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
  onEditMemberSavings,
  onAddMember,
  onDeleteMember,
  onClearSavingsTransactions,
}: SavingsPageProps) {
  const [memberSearch, setMemberSearch] = useState('')
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  const [newMemberInitialSavings, setNewMemberInitialSavings] = useState('0')
  const [newMemberInitialSavingsDate, setNewMemberInitialSavingsDate] = useState(getLocalDate)
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [newMemberPassword, setNewMemberPassword] = useState('')
  const [newMemberError, setNewMemberError] = useState('')
  const [isAddingMember, setIsAddingMember] = useState(false)
  const [deletingMemberName, setDeletingMemberName] = useState<string | null>(null)
  const [editingSavingsMemberName, setEditingSavingsMemberName] = useState<string | null>(null)
  const [editedSavingsAmount, setEditedSavingsAmount] = useState('')
  const [savingsEditDate, setSavingsEditDate] = useState(getLocalDate)
  const [savingsEditReason, setSavingsEditReason] = useState('')
  const [savingsEditError, setSavingsEditError] = useState('')
  const [deleteAdminPassword, setDeleteAdminPassword] = useState('')
  const [deleteMemberError, setDeleteMemberError] = useState('')
  const [isDeletingMember, setIsDeletingMember] = useState(false)
  const [isClearConfirmationOpen, setIsClearConfirmationOpen] = useState(false)
  const [clearAdminPassword, setClearAdminPassword] = useState('')
  const [clearConfirmationText, setClearConfirmationText] = useState('')
  const [clearSavingsError, setClearSavingsError] = useState('')
  const [isClearingSavings, setIsClearingSavings] = useState(false)
  const filteredMembers = members.filter((member) =>
    member.name.toLowerCase().includes(memberSearch.trim().toLowerCase()),
  )
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

  const handleAddMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = newMemberName.trim()
    const email = newMemberEmail.trim().toLowerCase()
    const initialSavings = Number(newMemberInitialSavings)
    const initialSavingsCents = Math.round(initialSavings * 100)
    if (!name) {
      setNewMemberError('Enter the member’s full name.')
      return
    }
    if (newMemberInitialSavings === '' || !Number.isFinite(initialSavings) || initialSavings < 0
      || !Number.isSafeInteger(initialSavingsCents)) {
      setNewMemberError('Enter an initial savings amount of zero or more.')
      return
    }
    if (!newMemberInitialSavingsDate) {
      setNewMemberError('Choose the initial savings date.')
      return
    }
    if (!email || !newMemberPassword || newMemberPassword.length < 8) {
      setNewMemberError('Enter a valid email and a password of at least 8 characters.')
      return
    }

    setIsAddingMember(true)
    setNewMemberError('')
    try {
      const result = await onAddMember(name, initialSavingsCents / 100, newMemberInitialSavingsDate, email, newMemberPassword)
      if (!result.success) {
        setNewMemberError(result.message ?? 'Could not add this member.')
        return
      }
      setNewMemberName('')
      setNewMemberInitialSavings('0')
      setNewMemberInitialSavingsDate(getLocalDate())
      setNewMemberEmail('')
      setNewMemberPassword('')
      setIsAddMemberOpen(false)
    } catch (error) {
      setNewMemberError(error instanceof Error ? error.message : 'Could not add this member.')
    } finally {
      setIsAddingMember(false)
    }
  }

  const handleEditMemberSavings = (event: FormEvent<HTMLFormElement>, member: Member) => {
    event.preventDefault()
    const amount = Number(editedSavingsAmount)
    const amountInCents = Math.round(amount * 100)
    if (editedSavingsAmount === '' || !Number.isFinite(amount) || amount < 0
      || !Number.isSafeInteger(amountInCents)) {
      setSavingsEditError('Enter a valid savings amount of zero or more.')
      return
    }
    if (!savingsEditDate || !savingsEditReason.trim()) {
      setSavingsEditError('Choose a date and enter a reason for this adjustment.')
      return
    }
    if (amountInCents === Math.round(getMemberSavings(member) * 100)) {
      setSavingsEditError('Enter an amount different from the current savings.')
      return
    }

    onEditMemberSavings(member.name, amountInCents / 100, savingsEditReason.trim(), savingsEditDate)
    setEditingSavingsMemberName(null)
    setEditedSavingsAmount('')
    setSavingsEditDate(getLocalDate())
    setSavingsEditReason('')
    setSavingsEditError('')
  }

  const handleClearSavingsTransactions = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (clearConfirmationText !== 'delete ALL datas') {
      setClearSavingsError('Type “delete ALL datas” exactly to continue.')
      return
    }

    setIsClearingSavings(true)
    setClearSavingsError('')
    try {
      const result = await onClearSavingsTransactions(clearAdminPassword, clearConfirmationText)
      if (!result.success) {
        setClearSavingsError(result.message ?? 'Could not clear savings transactions.')
        return
      }
      setIsClearConfirmationOpen(false)
      setClearAdminPassword('')
      setClearConfirmationText('')
    } catch (error) {
      setClearSavingsError(error instanceof Error ? error.message : 'Could not verify the admin password.')
    } finally {
      setIsClearingSavings(false)
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
          </article>
        ))}
      </section>

      <section className="panel full-width-panel savings-directory-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Savings</p>
            <h3>Member directory</h3>
          </div>
          <div className="borrower-directory-controls">
            {isAdmin && (
              <button type="button" className="primary-button" onClick={() => {
                setIsAddMemberOpen((open) => !open)
                setNewMemberError('')
              }}>
                {isAddMemberOpen ? 'Cancel' : 'Add members'}
              </button>
            )}
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
        {isAdmin && isAddMemberOpen && (
          <form className="add-member-form savings-add-member-form" noValidate onSubmit={(event) => void handleAddMember(event)}>
            <label>
              Full name
              <input autoFocus value={newMemberName} onChange={(event) => {
                setNewMemberName(event.target.value)
                setNewMemberError('')
              }} placeholder="Member name" />
            </label>
            <label>
              Initial savings (PHP)
              <input type="number" min="0" step="0.01" value={newMemberInitialSavings} onChange={(event) => {
                setNewMemberInitialSavings(event.target.value)
                setNewMemberError('')
              }} />
            </label>
            <label>
              Date
              <input type="date" required value={newMemberInitialSavingsDate} onChange={(event) => {
                setNewMemberInitialSavingsDate(event.target.value)
                setNewMemberError('')
              }} />
            </label>
            <label>
              Email address
              <input type="email" autoComplete="email" required value={newMemberEmail} onChange={(event) => {
                setNewMemberEmail(event.target.value)
                setNewMemberError('')
              }} />
            </label>
            <label>
              Password
              <input type="password" autoComplete="new-password" minLength={8} required value={newMemberPassword} onChange={(event) => {
                setNewMemberPassword(event.target.value)
                setNewMemberError('')
              }} />
            </label>
            <button type="submit" className="primary-button" disabled={isAddingMember}>
              {isAddingMember ? 'Adding member…' : 'Save member'}
            </button>
            {newMemberError && <p className="member-error" role="alert">{newMemberError}</p>}
          </form>
        )}
        {members.length > 0 ? (
          filteredMembers.length > 0 ? (
            <ul className="savings-directory-list">
              {filteredMembers.map((member) => (
                <li key={member.name} className="savings-directory-item">
                  <div className="savings-member-header">
                    <strong>{member.name}</strong>
                    {isAdmin && (
                      <div className="savings-member-header-actions">
                        <button
                          type="button"
                          className="secondary-button edit-member-button"
                          onClick={() => {
                            if (editingSavingsMemberName === member.name) {
                              setEditingSavingsMemberName(null)
                              setSavingsEditError('')
                              return
                            }
                            setEditingSavingsMemberName(member.name)
                            setEditedSavingsAmount(getMemberSavings(member).toFixed(2))
                            setSavingsEditDate(getLocalDate())
                            setSavingsEditReason('')
                            setSavingsEditError('')
                            setDeletingMemberName(null)
                            setDeleteAdminPassword('')
                            setDeleteMemberError('')
                          }}
                        >
                          {editingSavingsMemberName === member.name ? 'Cancel' : 'Edit'}
                        </button>
                        <button
                          type="button"
                          className="secondary-button delete-member-button"
                          onClick={() => {
                            setDeletingMemberName((currentName) => currentName === member.name ? null : member.name)
                            setDeleteAdminPassword('')
                            setDeleteMemberError('')
                            setEditingSavingsMemberName(null)
                            setSavingsEditError('')
                          }}
                        >
                          {deletingMemberName === member.name ? 'Cancel' : 'Delete'}
                        </button>
                      </div>
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
                      <span>Guarantor Amount</span>
                      <strong>{formatCurrency(borrowers
                        .filter((borrower) => borrower.guarantorName?.trim().toLowerCase() === member.name.trim().toLowerCase())
                        .reduce((total, borrower) => total + borrower.loanAmount, 0))}</strong>
                    </div>
                  </div>
                  {isAdmin && editingSavingsMemberName === member.name && (
                    <form
                      className="edit-member-savings-form"
                      noValidate
                      onSubmit={(event) => handleEditMemberSavings(event, member)}
                    >
                      <p>
                        Current savings: {formatCurrency(getMemberSavings(member))}. Saving a new amount creates a
                        transaction showing the before and after balances.
                      </p>
                      <label>
                        New savings amount (PHP)
                        <input
                          autoFocus
                          type="number"
                          min="0"
                          step="0.01"
                          value={editedSavingsAmount}
                          onChange={(event) => {
                            setEditedSavingsAmount(event.target.value)
                            setSavingsEditError('')
                          }}
                        />
                      </label>
                      <label>
                        Date
                        <input
                          type="date"
                          required
                          value={savingsEditDate}
                          onChange={(event) => {
                            setSavingsEditDate(event.target.value)
                            setSavingsEditError('')
                          }}
                        />
                      </label>
                      <label>
                        Reason
                        <input
                          type="text"
                          required
                          value={savingsEditReason}
                          onChange={(event) => {
                            setSavingsEditReason(event.target.value)
                            setSavingsEditError('')
                          }}
                          placeholder="Reason for adjustment"
                        />
                      </label>
                      <button type="submit" className="primary-button">Save adjustment</button>
                      {savingsEditError && <p className="member-error" role="alert">{savingsEditError}</p>}
                    </form>
                  )}
                  {canEditSavings && (
                    <>
                      <AddMemberSavingsForm memberName={member.name} onAddSavings={onAddSavings} />
                    </>
                  )}
                  {isAdmin && (
                    <PullOutMemberSavingsForm member={member} onPullOutSavings={onPullOutSavings} />
                  )}
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
                              {transaction.recordedBy && ` · Logged by ${transaction.recordedBy}`}
                              {transaction.reason && ` · ${transaction.reason}`}
                              {transaction.previousAmount !== undefined && transaction.newAmount !== undefined
                                && ` · From ${formatCurrency(transaction.previousAmount)} to ${formatCurrency(transaction.newAmount)}`}
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
          {isAdmin && (isClearConfirmationOpen ? (
            <form
              className="clear-loans-form clear-savings-form"
              noValidate
              onSubmit={(event) => void handleClearSavingsTransactions(event)}
            >
              <label>
                Admin password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={clearAdminPassword}
                  onChange={(event) => {
                    setClearAdminPassword(event.target.value)
                    setClearSavingsError('')
                  }}
                />
              </label>
              <label>
                Type delete ALL datas
                <input
                  type="text"
                  autoComplete="off"
                  required
                  value={clearConfirmationText}
                  onChange={(event) => {
                    setClearConfirmationText(event.target.value)
                    setClearSavingsError('')
                  }}
                />
              </label>
              <button type="submit" className="danger-button" disabled={isClearingSavings}>
                {isClearingSavings ? 'Clearing…' : 'OK'}
              </button>
              <button
                type="button"
                className="secondary-button clear-loans-cancel"
                disabled={isClearingSavings}
                onClick={() => {
                  setIsClearConfirmationOpen(false)
                  setClearAdminPassword('')
                  setClearConfirmationText('')
                  setClearSavingsError('')
                }}
              >
                Cancel
              </button>
              {clearSavingsError && <p className="clear-loans-error" role="alert">{clearSavingsError}</p>}
            </form>
          ) : (
            <button
              type="button"
              className="danger-button"
              onClick={() => setIsClearConfirmationOpen(true)}
            >
              Clear all data
            </button>
          ))}
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
                    {transaction.previousAmount !== undefined && transaction.newAmount !== undefined
                      && ` · From ${formatCurrency(transaction.previousAmount)} to ${formatCurrency(transaction.newAmount)}`}
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
  isAdmin,
  onAddBorrower,
  onAddBorrowerInterest,
  onPayBorrowerInterest,
  onPayBorrowerPrincipal,
  onAddBorrowerPrincipal,
  onEditBorrowerPrincipal,
  onRemoveBorrower,
  onClearLoans,
  totalInterestPaid,
}: {
  borrowers: Borrower[]
  guarantors: string[]
  isAdmin: boolean
  onAddBorrower: (borrower: Borrower) => void
  onAddBorrowerInterest: (borrowerId: string, date: string) => void
  onPayBorrowerInterest: (borrowerId: string, amount: number, date: string) => void
  onPayBorrowerPrincipal: (borrowerId: string, amount: number) => void
  onAddBorrowerPrincipal: (borrowerId: string, amount: number, date: string) => void
  onEditBorrowerPrincipal: (borrowerId: string, amount: number, reason: string, date: string) => void
  onRemoveBorrower: (borrowerId: string) => void
  onClearLoans: (adminPassword: string, confirmationText: string) => Promise<{ success: boolean; message?: string }>
  totalInterestPaid: number
}) {
  const [isAddingBorrower, setIsAddingBorrower] = useState(false)
  const [borrowerName, setBorrowerName] = useState('')
  const [guarantorName, setGuarantorName] = useState('')
  const [borrowerLoanAmount, setBorrowerLoanAmount] = useState('')
  const [borrowerInterestRate, setBorrowerInterestRate] = useState('3')
  const [borrowerError, setBorrowerError] = useState('')
  const [payingBorrowerId, setPayingBorrowerId] = useState<string | null>(null)
  const [interestPaymentAmount, setInterestPaymentAmount] = useState('')
  const [interestPaymentDate, setInterestPaymentDate] = useState(getLocalDate)
  const [interestPaymentError, setInterestPaymentError] = useState('')
  const [addingInterestBorrowerId, setAddingInterestBorrowerId] = useState<string | null>(null)
  const [interestAdditionDate, setInterestAdditionDate] = useState(getLocalDate)
  const [interestAdditionError, setInterestAdditionError] = useState('')
  const [payingPrincipalBorrowerId, setPayingPrincipalBorrowerId] = useState<string | null>(null)
  const [principalPaymentAmount, setPrincipalPaymentAmount] = useState('')
  const [principalPaymentError, setPrincipalPaymentError] = useState('')
  const [addingPrincipalBorrowerId, setAddingPrincipalBorrowerId] = useState<string | null>(null)
  const [principalAdditionAmount, setPrincipalAdditionAmount] = useState('')
  const [principalAdditionDate, setPrincipalAdditionDate] = useState(getLocalDate)
  const [principalAdditionError, setPrincipalAdditionError] = useState('')
  const [editingPrincipalBorrowerId, setEditingPrincipalBorrowerId] = useState<string | null>(null)
  const [editedPrincipalAmount, setEditedPrincipalAmount] = useState('')
  const [principalEditReason, setPrincipalEditReason] = useState('')
  const [principalEditError, setPrincipalEditError] = useState('')
  const [borrowerSearch, setBorrowerSearch] = useState('')
  const [borrowerDirectoryFilter, setBorrowerDirectoryFilter] = useState<BorrowerDirectoryFilter>('all')
  const [isClearConfirmationOpen, setIsClearConfirmationOpen] = useState(false)
  const [clearAdminPassword, setClearAdminPassword] = useState('')
  const [clearConfirmationText, setClearConfirmationText] = useState('')
  const [clearLoansError, setClearLoansError] = useState('')
  const [isClearingLoans, setIsClearingLoans] = useState(false)
  const totalLoanProceeds = borrowers.reduce((total, borrower) => total + borrower.loanAmount, 0)
  const totalReceivableInterest = borrowers.reduce((total, borrower) => total + borrower.paydayInterest, 0)
  const filteredBorrowers = borrowers.filter((borrower) =>
    borrower.name.toLowerCase().includes(borrowerSearch.trim().toLowerCase()),
  )
  const allBorrowerSections = [
    {
      title: 'Active loans',
      borrowers: filteredBorrowers.filter((borrower) =>
        hasOutstandingBorrowerBalance(borrower.loanAmount)
        || hasOutstandingBorrowerBalance(borrower.paydayInterest),
      ),
    },
    {
      title: 'Fully paid',
      borrowers: filteredBorrowers.filter((borrower) =>
        !hasOutstandingBorrowerBalance(borrower.loanAmount)
        && !hasOutstandingBorrowerBalance(borrower.paydayInterest),
      ),
    },
  ]
  const borrowerSections = allBorrowerSections.filter((section) =>
    borrowerDirectoryFilter === 'all'
    || (borrowerDirectoryFilter === 'active' && section.title === 'Active loans')
    || (borrowerDirectoryFilter === 'paid' && section.title === 'Fully paid'),
  )
  const visibleBorrowerCount = borrowerSections.reduce((total, section) => total + section.borrowers.length, 0)
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
    const interestRate = Number(borrowerInterestRate)
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
    if (borrowerInterestRate === '' || !Number.isFinite(interestRate) || interestRate < 0 || interestRate > 100) {
      setBorrowerError('Enter an interest rate from 0 to 100 percent.')
      return
    }

    onAddBorrower({
      id: crypto.randomUUID(),
      name,
      guarantorName,
      email: '',
      loanAmount,
      interestRate,
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
    setBorrowerInterestRate('3')
    setBorrowerError('')
    setIsAddingBorrower(false)
  }

  const handleClearLoans = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (clearConfirmationText !== 'delete ALL datas') {
      setClearLoansError('Type “delete ALL datas” exactly to continue.')
      return
    }

    setIsClearingLoans(true)
    setClearLoansError('')
    try {
      const result = await onClearLoans(clearAdminPassword, clearConfirmationText)
      if (!result.success) {
        setClearLoansError(result.message ?? 'Could not clear loan records.')
        return
      }
      setIsClearConfirmationOpen(false)
      setClearAdminPassword('')
      setClearConfirmationText('')
      setBorrowerSearch('')
    } catch (error) {
      setClearLoansError(error instanceof Error ? error.message : 'Could not verify the admin password.')
    } finally {
      setIsClearingLoans(false)
    }
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
    if (!interestPaymentDate) {
      setInterestPaymentError('Select the date the payment was received.')
      return
    }

    onPayBorrowerInterest(borrower.id, roundedAmount, interestPaymentDate)
    setPayingBorrowerId(null)
    setInterestPaymentAmount('')
    setInterestPaymentDate(getLocalDate())
    setInterestPaymentError('')
  }

  const handleAddBorrowerInterest = (event: FormEvent<HTMLFormElement>, borrower: Borrower) => {
    event.preventDefault()
    if (!interestAdditionDate) {
      setInterestAdditionError('Select the date the interest was added.')
      return
    }

    onAddBorrowerInterest(borrower.id, interestAdditionDate)
    setAddingInterestBorrowerId(null)
    setInterestAdditionError('')
  }

  const handlePayBorrowerPrincipal = (event: FormEvent<HTMLFormElement>, borrower: Borrower) => {
    event.preventDefault()
    if (hasOutstandingBorrowerBalance(borrower.paydayInterest)) {
      setPrincipalPaymentError('Pay all outstanding interest before paying principal.')
      return
    }
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
    if (!principalAdditionDate) {
      setPrincipalAdditionError('Select the date the principal was added.')
      return
    }
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

    onAddBorrowerPrincipal(borrower.id, roundedAmount, principalAdditionDate)
    setAddingPrincipalBorrowerId(null)
    setPrincipalAdditionAmount('')
    setPrincipalAdditionDate(getLocalDate())
    setPrincipalAdditionError('')
  }

  const handleEditBorrowerPrincipal = (event: FormEvent<HTMLFormElement>, borrower: Borrower) => {
    event.preventDefault()
    const amount = Number(editedPrincipalAmount)
    const roundedAmount = Number(amount.toFixed(2))
    if (editedPrincipalAmount === '' || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(roundedAmount)) {
      setPrincipalEditError('Enter a principal amount of zero or greater.')
      return
    }
    if (!principalEditReason.trim()) {
      setPrincipalEditError('Enter a reason for editing the principal.')
      return
    }
    if (roundedAmount === Number(borrower.loanAmount.toFixed(2))) {
      setPrincipalEditError('Enter a principal amount different from the current value.')
      return
    }
    onEditBorrowerPrincipal(borrower.id, roundedAmount, principalEditReason.trim(), getLocalDate())
    setEditingPrincipalBorrowerId(null)
    setEditedPrincipalAmount('')
    setPrincipalEditReason('')
    setPrincipalEditError('')
  }

  return (
    <main className="page-view">
      <section className="page-header loans-page-header">
        <div className="loans-title">
          <p className="eyebrow">Loans</p>
          <h2>LOANS</h2>
        </div>
        <time className="loans-current-date" dateTime={getLocalDate()}>{formatDate(getLocalDate())}</time>
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

      {isAdmin && isAddingBorrower && (
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
            Interest rate (%)
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              value={borrowerInterestRate}
              onChange={(event) => {
                setBorrowerInterestRate(event.target.value)
                setBorrowerError('')
              }}
              placeholder="3"
            />
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
            <button
              type="button"
              className="secondary-button"
              disabled={!isAdmin}
              onClick={() => setIsAddingBorrower((open) => !open)}
            >
              {isAddingBorrower ? 'Cancel' : 'Add borrower'}
            </button>
            {isAdmin && (isClearConfirmationOpen ? (
              <form className="clear-loans-form" noValidate onSubmit={(event) => void handleClearLoans(event)}>
                <label>
                  Admin password
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={clearAdminPassword}
                    onChange={(event) => {
                      setClearAdminPassword(event.target.value)
                      setClearLoansError('')
                    }}
                  />
                </label>
                <label>
                  Type delete ALL datas
                  <input
                    type="text"
                    autoComplete="off"
                    required
                    value={clearConfirmationText}
                    onChange={(event) => {
                      setClearConfirmationText(event.target.value)
                      setClearLoansError('')
                    }}
                  />
                </label>
                <button type="submit" className="danger-button" disabled={isClearingLoans}>
                  {isClearingLoans ? 'Clearing…' : 'OK'}
                </button>
                <button
                  type="button"
                  className="secondary-button clear-loans-cancel"
                  disabled={isClearingLoans}
                  onClick={() => {
                    setIsClearConfirmationOpen(false)
                    setClearAdminPassword('')
                    setClearConfirmationText('')
                    setClearLoansError('')
                  }}
                >
                  Cancel
                </button>
                {clearLoansError && <p className="clear-loans-error" role="alert">{clearLoansError}</p>}
              </form>
            ) : (
              <button
                type="button"
                className="danger-button"
                onClick={() => setIsClearConfirmationOpen(true)}
              >
                Clear all data
              </button>
            ))}
            <select
              className="borrower-filter"
              aria-label="Filter borrowers by loan status"
              value={borrowerDirectoryFilter}
              onChange={(event) => setBorrowerDirectoryFilter(event.target.value as BorrowerDirectoryFilter)}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="paid">Fully paid</option>
            </select>
            <input
              className="borrower-search"
              type="search"
              aria-label="Search active and fully paid borrowers"
              value={borrowerSearch}
              onChange={(event) => setBorrowerSearch(event.target.value)}
              placeholder="Search all borrowers"
            />
            <span className="meta-pill">{visibleBorrowerCount} shown</span>
          </div>
        </div>
        {borrowers.length > 0 ? (
          visibleBorrowerCount > 0 ? (
            <div className="borrower-groups">
              {borrowerSections.map((section) => section.borrowers.length > 0 && (
                <section key={section.title} className="borrower-group" aria-label={section.title}>
                  <div className="borrower-group-heading">
                    <h4>{section.title}</h4>
                    <span>{section.borrowers.length}</span>
                  </div>
                  <ul className="borrower-list">
                    {section.borrowers.map((borrower) => (
              <li key={borrower.id} className="borrower-item">
                <div className="borrower-item-header">
                  <div className="borrower-name-principal">
                    <strong>{borrower.name}</strong>
                    <span>Initial principal: {formatBorrowerCurrency(
                      borrower.transactions.find((transaction) => transaction.type === 'loan')?.amount
                      ?? borrower.loanAmount,
                    )}</span>
                  </div>
                  <div className="borrower-actions">
                    <button
                      type="button"
                      className="secondary-button borrower-interest-button"
                      disabled={!isAdmin}
                      onClick={() => {
                        setAddingInterestBorrowerId((currentId) =>
                          currentId === borrower.id ? null : borrower.id,
                        )
                        setInterestAdditionDate(getLocalDate())
                        setInterestAdditionError('')
                        setPayingBorrowerId(null)
                        setPayingPrincipalBorrowerId(null)
                        setAddingPrincipalBorrowerId(null)
                      }}
                    >
                      Add interest
                    </button>
                    <button
                      type="button"
                      className="secondary-button borrower-interest-button"
                      disabled={!isAdmin || borrower.loanAmount <= 0 || hasOutstandingBorrowerBalance(borrower.paydayInterest)}
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
                      disabled={!isAdmin}
                      onClick={() => {
                        setAddingPrincipalBorrowerId((currentId) => currentId === borrower.id ? null : borrower.id)
                        setPrincipalAdditionAmount('')
                        setPrincipalAdditionDate(getLocalDate())
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
                      disabled={!isAdmin}
                      onClick={() => {
                        setEditingPrincipalBorrowerId((currentId) => currentId === borrower.id ? null : borrower.id)
                        setEditedPrincipalAmount(borrower.loanAmount.toFixed(2))
                        setPrincipalEditReason('')
                        setPrincipalEditError('')
                        setAddingPrincipalBorrowerId(null)
                        setPayingPrincipalBorrowerId(null)
                        setPayingBorrowerId(null)
                      }}
                    >
                      Edit principal
                    </button>
                    <button
                      type="button"
                      className="secondary-button borrower-interest-button"
                      disabled={!isAdmin || borrower.paydayInterest <= 0}
                      onClick={() => {
                        setPayingBorrowerId((currentId) => currentId === borrower.id ? null : borrower.id)
                        setInterestPaymentAmount('')
                        setInterestPaymentDate(getLocalDate())
                        setInterestPaymentError('')
                        setPayingPrincipalBorrowerId(null)
                      }}
                    >
                      Pay interest
                    </button>
                    <button
                      type="button"
                      className="secondary-button borrower-interest-button"
                      disabled={!isAdmin || hasOutstandingBorrowerBalance(borrower.loanAmount) || hasOutstandingBorrowerBalance(borrower.paydayInterest)}
                      onClick={() => onRemoveBorrower(borrower.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {isAdmin && addingInterestBorrowerId === borrower.id && (
                  <form
                    className="interest-payment-form"
                    noValidate
                    onSubmit={(event) => handleAddBorrowerInterest(event, borrower)}
                  >
                    <label>
                      Interest date
                      <input
                        type="date"
                        required
                        value={interestAdditionDate}
                        onChange={(event) => {
                          setInterestAdditionDate(event.target.value)
                          setInterestAdditionError('')
                        }}
                      />
                    </label>
                    <button type="submit" className="primary-button">Add interest</button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setAddingInterestBorrowerId(null)
                        setInterestAdditionError('')
                      }}
                    >
                      Cancel
                    </button>
                    {interestAdditionError && <p className="member-error" role="alert">{interestAdditionError}</p>}
                  </form>
                )}
                <div className="borrower-metrics">
                  {borrower.guarantorName && <span><strong>Guarantor:</strong> {borrower.guarantorName}</span>}
                  <span className="borrower-metric principal-metric"><strong>Principal:</strong> {formatBorrowerCurrency(borrower.loanAmount)}</span>
                  <span className="borrower-metric interest-metric"><strong>Rate:</strong> {borrower.interestRate}%</span>
                  <span className="borrower-metric interest-metric"><strong>Interest:</strong> {formatBorrowerCurrency(borrower.paydayInterest)}</span>
                </div>
                {payingBorrowerId === borrower.id && (
                  <form
                    className="interest-payment-form"
                    noValidate
                    onSubmit={(event) => handlePayBorrowerInterest(event, borrower)}
                  >
                    <label>
                      Date received
                      <input
                        type="date"
                        required
                        value={interestPaymentDate}
                        onChange={(event) => {
                          setInterestPaymentDate(event.target.value)
                          setInterestPaymentError('')
                        }}
                      />
                    </label>
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
                {isAdmin && payingPrincipalBorrowerId === borrower.id && (
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
                {isAdmin && editingPrincipalBorrowerId === borrower.id && (
                  <form
                    className="interest-payment-form"
                    noValidate
                    onSubmit={(event) => handleEditBorrowerPrincipal(event, borrower)}
                  >
                    <label>
                      New principal (PHP)
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={editedPrincipalAmount}
                        onChange={(event) => {
                          setEditedPrincipalAmount(event.target.value)
                          setPrincipalEditError('')
                        }}
                      />
                    </label>
                    <label>
                      Reason for editing
                      <input
                        type="text"
                        maxLength={500}
                        required
                        value={principalEditReason}
                        onChange={(event) => {
                          setPrincipalEditReason(event.target.value)
                          setPrincipalEditError('')
                        }}
                        placeholder="Explain the principal correction"
                      />
                    </label>
                    <button type="submit" className="primary-button">Save principal</button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setEditingPrincipalBorrowerId(null)
                        setPrincipalEditError('')
                      }}
                    >
                      Cancel
                    </button>
                    {principalEditError && <p className="member-error" role="alert">{principalEditError}</p>}
                  </form>
                )}
                {isAdmin && addingPrincipalBorrowerId === borrower.id && (
                  <form
                    className="interest-payment-form"
                    noValidate
                    onSubmit={(event) => handleAddBorrowerPrincipal(event, borrower)}
                  >
                    <label>
                      Date added
                      <input
                        type="date"
                        required
                        value={principalAdditionDate}
                        onChange={(event) => {
                          setPrincipalAdditionDate(event.target.value)
                          setPrincipalAdditionError('')
                        }}
                      />
                    </label>
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
                                  : transaction.type === 'principal-adjustment'
                                    ? 'Principal edited'
                                  : transaction.type === 'interest' ? 'Interest' : 'Loan'}
                          </span>
                          <strong>
                              {transaction.type === 'principal-adjustment' && transaction.previousAmount !== undefined && transaction.newAmount !== undefined
                                ? `${formatBorrowerCurrency(transaction.previousAmount)} → ${formatBorrowerCurrency(transaction.newAmount)}`
                                : `${transaction.type === 'interest-payment' || transaction.type === 'principal-payment' ? '-' : ''}${formatBorrowerCurrency(transaction.amount)}`}
                          </strong>
                          <time className="loan-transaction-date">{formatDate(transaction.date)}</time>
                          {transaction.type === 'principal-adjustment' && transaction.reason && (
                              <small className="loan-transaction-reason">Reason: {transaction.reason}</small>
                          )}
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
                </section>
              ))}
            </div>
          ) : (
            <p className="savings-history-empty">
              {borrowerSearch.trim()
                ? `No borrowers match “${borrowerSearch}” in this view.`
                : 'No borrowers in this view.'}
            </p>
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
                          : transaction.type === 'principal-adjustment'
                            ? 'Principal edited'
                          : transaction.type === 'interest' ? 'Interest added' : 'Loan issued'}
                    {' · '}{transaction.borrowerName}
                  </strong>
                  <small>{formatDate(transaction.date)}</small>
                  {transaction.type === 'principal-adjustment' && transaction.reason && (
                    <small className="loan-transaction-reason">Reason: {transaction.reason}</small>
                  )}
                </div>
                {transaction.type === 'principal-adjustment'
                  && transaction.previousAmount !== undefined
                  && transaction.newAmount !== undefined ? (
                    <span>{formatCurrency(transaction.previousAmount)} → {formatCurrency(transaction.newAmount)}</span>
                  ) : (
                    <span className={transaction.amount < 0 ? 'negative' : 'positive'}>
                      {transaction.amount < 0 ? '-' : '+'}{formatCurrency(Math.abs(transaction.amount))}
                    </span>
                  )}
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

function MemberProfitSummary({
  memberProfits,
}: {
  memberProfits: ReturnType<typeof getMemberProfitShares>
}) {
  return (
    <section className="panel full-width-panel profits-section profits-member-summary-section">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Overview</p>
          <h3>Members Profit Summary</h3>
        </div>
      </div>
      {memberProfits.length > 0 ? (
        <ul className="profits-member-summary-list">
          {memberProfits.map(({ member, sharePercentage, profitShare }) => (
            <li key={member.name} className="profits-member-summary-row">
              <strong>{member.name}</strong>
              <span>
                <small>Profit</small>
                <b>{formatCurrency(profitShare)}</b>
              </span>
              <span>
                <small>Savings share</small>
                <b>{sharePercentage.toFixed(1)}%</b>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="savings-history-empty">No member profit shares to summarize.</p>
      )}
    </section>
  )
}

function ProfitsPage({
  members,
  borrowers,
  removedBorrowerTransactions,
  profitTransfers,
  otherProfits,
  profitCashouts,
  totalInterestPaid,
  totalReceivableInterest,
  totalGroupAllowance,
  isAdmin,
  onAddOtherProfit,
  onApplyMemberProfitAction,
  onSendToEncoder,
  onTransferProfit,
  onClearProfitTransactions,
}: {
  members: Member[]
  borrowers: Borrower[]
  removedBorrowerTransactions: RemovedBorrowerTransaction[]
  profitTransfers: ProfitTransfer[]
  otherProfits: OtherProfit[]
  profitCashouts: ProfitCashout[]
  totalInterestPaid: number
  totalReceivableInterest: number
  totalGroupAllowance: number
  isAdmin: boolean
  onAddOtherProfit: (profit: OtherProfit) => void
  onApplyMemberProfitAction: (memberName: string, amount: number, action: 'add to savings' | 'get profit' | 'penalty', memberProfit: number) => void
  onSendToEncoder: (encoderName: string, payments: Array<{ memberName: string; amount: number }>) => void
  onTransferProfit: (dateFrom: string, dateTo: string) => void
  onClearProfitTransactions: (adminPassword: string, confirmationText: string) => Promise<{ success: boolean; message?: string }>
}) {
  const [profitDateFrom, setProfitDateFrom] = useState('')
  const [profitDateTo, setProfitDateTo] = useState(getLocalDate)
  const [selectedProfitTransferDate, setSelectedProfitTransferDate] = useState('')
  const [isTransferFormOpen, setIsTransferFormOpen] = useState(false)
  const [transferDateFrom, setTransferDateFrom] = useState('')
  const [transferDateTo, setTransferDateTo] = useState(getLocalDate)
  const [paymentSearch, setPaymentSearch] = useState('')
  const [isClearConfirmationOpen, setIsClearConfirmationOpen] = useState(false)
  const [clearAdminPassword, setClearAdminPassword] = useState('')
  const [clearConfirmationText, setClearConfirmationText] = useState('')
  const [clearProfitError, setClearProfitError] = useState('')
  const [isClearingProfit, setIsClearingProfit] = useState(false)
  const [selectedEncoder, setSelectedEncoder] = useState('')
  const [encoderPercentage, setEncoderPercentage] = useState('5')
  const [otherProfitAmount, setOtherProfitAmount] = useState('')
  const [otherProfitSource, setOtherProfitSource] = useState('')
  const [otherProfitDate, setOtherProfitDate] = useState(getLocalDate)
  const [otherProfitError, setOtherProfitError] = useState('')
  const [groupEncoderNames] = useState(() => [...new Set(
    loadGroupUpdateData().data.groupEncoders.map((encoder) => encoder.name.trim()).filter(Boolean),
  )])
  const [groupOperationCosts] = useState(() => loadGroupUpdateData().data.operationCosts)
  const totalGroupOperationCost = groupOperationCosts.reduce((total, cost) => total + cost.amount, 0)
  const profitTransferred = Number(profitTransfers.reduce((total, transfer) => total + transfer.amount, 0).toFixed(2))
  const otherProfitTotal = Number(otherProfits.reduce((total, profit) => total + profit.amount, 0).toFixed(2))
  const distributedProfitTotal = profitTransferred
  const profitTransferDates = [...new Set(profitTransfers.map((transfer) => transfer.date))]
    .sort((first, second) => second.localeCompare(first))
  const activeProfitTransferDate = profitTransferDates.includes(selectedProfitTransferDate)
    ? selectedProfitTransferDate
    : profitTransferDates[0] ?? ''
  const selectedProfitTransferTotal = profitTransfers
    .filter((transfer) => transfer.date === activeProfitTransferDate)
    .reduce((total, transfer) => total + transfer.amount, 0)
  const profitBalance = Number(Math.max(0, totalInterestPaid + otherProfitTotal - profitTransferred).toFixed(2))
  const profitSources = [
    ...borrowers.flatMap((borrower) => (borrower.transactions ?? [])
      .filter((transaction) => transaction.type === 'interest-payment')
      .map((transaction) => ({
        id: `${borrower.id}-${transaction.id}`,
        borrowerName: borrower.name,
        amount: transaction.amount,
        date: transaction.date,
      }))),
    ...removedBorrowerTransactions
      .filter(({ transaction }) => transaction.type === 'interest-payment')
      .map(({ borrowerId, borrowerName, transaction }) => ({
        id: `${borrowerId}-${transaction.id}`,
        borrowerName,
        amount: transaction.amount,
        date: transaction.date,
      })),
    ...otherProfits.map((profit) => ({
      id: `other-profit-${profit.id}`,
      borrowerName: profit.source,
      amount: profit.amount,
      date: profit.date,
    })),
  ].sort((first, second) => second.date.localeCompare(first.date))
  const transferredByPayment = new Map<string, number>()
  profitTransfers.forEach((transfer) => transfer.paymentAllocations?.forEach((allocation) => {
    transferredByPayment.set(
      allocation.transactionId,
      (transferredByPayment.get(allocation.transactionId) ?? 0) + allocation.amount,
    )
  }))
  const availableTransferPayments = profitSources.filter((payment) =>
    (!transferDateFrom || payment.date >= transferDateFrom)
    && (!transferDateTo || payment.date <= transferDateTo),
  ).map((payment) => ({
    ...payment,
    availableAmount: Number(Math.max(0, payment.amount - (transferredByPayment.get(payment.id) ?? 0)).toFixed(2)),
  })).filter((payment) => payment.availableAmount > 0)
  const availableTransferTotal = availableTransferPayments.reduce((total, payment) => total + payment.availableAmount, 0)
  const filteredProfitSources = profitSources.filter((payment) =>
    (!profitDateFrom || payment.date >= profitDateFrom)
    && (!profitDateTo || payment.date <= profitDateTo),
  )
  const searchedProfitSources = filteredProfitSources.filter((payment) =>
    payment.borrowerName.toLowerCase().includes(paymentSearch.trim().toLowerCase()),
  )
  const handleClearProfitTransactions = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (clearConfirmationText !== 'delete ALL datas') {
      setClearProfitError('Type “delete ALL datas” exactly to continue.')
      return
    }

    setIsClearingProfit(true)
    setClearProfitError('')
    try {
      const result = await onClearProfitTransactions(clearAdminPassword, clearConfirmationText)
      if (!result.success) {
        setClearProfitError(result.message ?? 'Could not clear profit transactions.')
        return
      }
      setIsClearConfirmationOpen(false)
      setClearAdminPassword('')
      setClearConfirmationText('')
    } catch (error) {
      setClearProfitError(error instanceof Error ? error.message : 'Could not verify the admin password.')
    } finally {
      setIsClearingProfit(false)
    }
  }
  const handleAddOtherProfit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const amount = Number(otherProfitAmount)
    const roundedAmount = Number(amount.toFixed(2))
    if (!otherProfitSource.trim()) {
      setOtherProfitError('Enter where this profit came from.')
      return
    }
    if (otherProfitAmount === '' || !Number.isFinite(amount) || roundedAmount <= 0) {
      setOtherProfitError('Enter an amount greater than zero.')
      return
    }
    if (!otherProfitDate) {
      setOtherProfitError('Choose the date this profit came from.')
      return
    }
    onAddOtherProfit({
      id: crypto.randomUUID(),
      amount: roundedAmount,
      source: otherProfitSource.trim(),
      date: otherProfitDate,
    })
    setOtherProfitAmount('')
    setOtherProfitSource('')
    setOtherProfitDate(getLocalDate())
    setOtherProfitError('')
  }
  const selectedInterestTotal = filteredProfitSources
    .filter((payment) => !payment.id.startsWith('other-profit-'))
    .reduce((total, payment) => total + payment.amount, 0)
  const selectedOtherProfitTotal = otherProfits
    .filter((profit) => profit.date >= profitDateFrom && profit.date <= profitDateTo)
    .reduce((total, profit) => total + profit.amount, 0)
  const profitsData = [
    { label: 'Net profit', value: formatCurrency(selectedInterestTotal + selectedOtherProfitTotal), tone: 'positive' },
    { label: 'Total receivable', value: formatCurrency(totalReceivableInterest), tone: 'positive' },
    { label: 'Group allowance', value: formatCurrency(totalGroupAllowance), tone: 'positive' },
    { label: 'Group operating cost', value: formatCurrency(totalGroupOperationCost), tone: 'negative' },
  ]
  const memberProfits = getMemberProfitShares(members, profitCashouts, distributedProfitTotal)
  const encoderRate = Number(encoderPercentage)
  const encoderPayments = memberProfits.map(({ member, profitShare }) => ({
    memberName: member.name,
    amount: Number((profitShare * encoderRate / 100).toFixed(2)),
  })).filter((payment) => payment.amount > 0)
  const encoderTotal = Number(encoderPayments.reduce((total, payment) => total + payment.amount, 0).toFixed(2))
  const encoderPaymentSent = profitCashouts.some((cashout) =>
    cashout.action === 'encoder' && cashout.transferTotal === distributedProfitTotal,
  )
  const sentEncoderTotal = Number(profitCashouts
    .filter((cashout) => cashout.action === 'encoder' && cashout.transferTotal === distributedProfitTotal)
    .reduce((total, cashout) => total + cashout.amount, 0)
    .toFixed(2))
  const memberProfitAlreadyPaid = profitCashouts.some((cashout) =>
    cashout.transferTotal === distributedProfitTotal
    && cashout.action !== 'encoder'
    && cashout.action !== 'penalty',
  )
  const canSendToEncoder = isAdmin
    && groupEncoderNames.length > 0
    && Boolean(selectedEncoder)
    && Number.isFinite(encoderRate)
    && encoderRate > 0
    && encoderRate <= 100
    && encoderTotal > 0
    && distributedProfitTotal > 0
    && !encoderPaymentSent
    && !memberProfitAlreadyPaid
  const [memberProfitActions, setMemberProfitActions] = useState<Record<string, 'add to savings' | 'get profit'>>({})
  const [memberPenaltyAmounts, setMemberPenaltyAmounts] = useState<Record<string, string>>({})

  return (
    <main className="page-view profits-page">
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
              <div className="profits-net-profit-body">
                <div className="profits-net-profit-content">
                  <p className="profits-net-profit-label">{item.label}</p>
                  <h2>{item.value}</h2>
                </div>
                <div className="profit-period-controls">
                  <label className="profit-period-date">
                    From
                    <input
                      type="date"
                      value={profitDateFrom}
                      max={profitDateTo}
                      onChange={(event) => {
                        const nextDate = event.target.value
                        setProfitDateFrom(nextDate)
                        if (nextDate > profitDateTo) setProfitDateTo(nextDate)
                      }}
                    />
                  </label>
                  <label className="profit-period-date">
                    To
                    <input
                      type="date"
                      value={profitDateTo}
                      min={profitDateFrom}
                      onChange={(event) => {
                        const nextDate = event.target.value
                        setProfitDateTo(nextDate)
                        if (nextDate < profitDateFrom) setProfitDateFrom(nextDate)
                      }}
                    />
                  </label>
                </div>
                <div className="profits-net-profit-details">
                  <div>
                    <span>Profit balance</span>
                    <strong>{formatCurrency(profitBalance)}</strong>
                  </div>
                  <div>
                    <span>Profit transferred</span>
                    {profitTransfers.length > 0 ? (
                      <>
                        <select
                          className="profit-transfer-date-select"
                          aria-label="Select profit transfer date"
                          value={activeProfitTransferDate}
                          onChange={(event) => setSelectedProfitTransferDate(event.target.value)}
                        >
                          {profitTransferDates.map((date) => (
                            <option key={date} value={date}>{formatDate(date)}</option>
                          ))}
                        </select>
                        <ul className="profit-transfer-history">
                          <li>
                            <strong>{formatCurrency(selectedProfitTransferTotal)}</strong>
                          </li>
                        </ul>
                      </>
                    ) : (
                      <small className="profit-transfer-empty">No transfers yet.</small>
                    )}
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={profitBalance <= 0}
                    onClick={() => {
                      setTransferDateFrom(profitDateFrom)
                      setTransferDateTo(profitDateTo)
                      setIsTransferFormOpen((isOpen) => !isOpen)
                    }}
                  >
                    Transfer profit
                  </button>
                </div>
                {isTransferFormOpen && (
                  <div className="profit-transfer-form">
                    <p>Transfer available interest and other profits received between these dates.</p>
                    <div className="profit-period-controls">
                      <label className="profit-period-date">
                        From
                        <input
                          type="date"
                          value={transferDateFrom}
                          max={transferDateTo}
                          onChange={(event) => {
                            const nextDate = event.target.value
                            setTransferDateFrom(nextDate)
                            if (nextDate > transferDateTo) setTransferDateTo(nextDate)
                          }}
                        />
                      </label>
                      <label className="profit-period-date">
                        To
                        <input
                          type="date"
                          value={transferDateTo}
                          min={transferDateFrom}
                          onChange={(event) => {
                            const nextDate = event.target.value
                            setTransferDateTo(nextDate)
                            if (nextDate < transferDateFrom) setTransferDateFrom(nextDate)
                          }}
                        />
                      </label>
                    </div>
                    <strong>Available to transfer: {formatCurrency(Math.min(availableTransferTotal, profitBalance))}</strong>
                    <div className="profit-transfer-actions">
                      <button
                        type="button"
                        className="primary-button"
                        disabled={availableTransferTotal <= 0 || profitBalance <= 0}
                        onClick={() => {
                          onTransferProfit(transferDateFrom, transferDateTo)
                          setIsTransferFormOpen(false)
                        }}
                      >
                        Confirm transfer
                      </button>
                      <button type="button" className="secondary-button" onClick={() => setIsTransferFormOpen(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
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

      <section className="panel full-width-panel profits-section profits-other-section">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Additional income</p>
            <h3>Other profits</h3>
          </div>
          <strong>{formatCurrency(otherProfitTotal)}</strong>
        </div>
        {isAdmin && (
          <form className="group-update-form" noValidate onSubmit={handleAddOtherProfit}>
            <label>
              Amount (PHP)
              <input
                type="number"
                min="0"
                step="0.01"
                value={otherProfitAmount}
                onChange={(event) => setOtherProfitAmount(event.target.value)}
                placeholder="0.00"
              />
            </label>
            <label>
              Source
              <input
                value={otherProfitSource}
                onChange={(event) => setOtherProfitSource(event.target.value)}
                placeholder="Where did it come from?"
              />
            </label>
            <label>
              Date received
              <input
                type="date"
                value={otherProfitDate}
                onChange={(event) => setOtherProfitDate(event.target.value)}
              />
            </label>
            <button type="submit" className="primary-button">Add profit</button>
            {otherProfitError && <p className="member-error" role="alert">{otherProfitError}</p>}
          </form>
        )}
        {otherProfits.length > 0 ? (
          <ul className="profit-interest-list">
            {[...otherProfits].sort((first, second) => second.date.localeCompare(first.date)).map((profit) => (
              <li key={profit.id}>
                <span>{profit.source}</span>
                <strong className="positive">+{formatCurrency(profit.amount)}</strong>
                <time dateTime={profit.date}>{formatDate(profit.date)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="savings-history-empty">No other profits recorded.</p>
        )}
      </section>

      <section className="panel full-width-panel profits-section profits-received-section">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Received payments</p>
            <h3>Interest and other profits received</h3>
          </div>
          <input
            className="borrower-search profits-payment-search"
            type="search"
            aria-label="Search received profit sources"
            placeholder="Search source"
            value={paymentSearch}
            onChange={(event) => setPaymentSearch(event.target.value)}
          />
        </div>
        {searchedProfitSources.length > 0 ? (
          <ul className="profit-interest-list">
            {searchedProfitSources.map((payment) => (
              <li key={payment.id}>
                <span>{payment.borrowerName}</span>
                <strong>{formatCurrency(payment.amount)}</strong>
                <time dateTime={payment.date}>{formatDate(payment.date)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="savings-history-empty">
            {filteredProfitSources.length > 0
              ? 'No received profit sources match your search.'
              : 'No interest or other profits received for the selected period.'}
          </p>
        )}
      </section>
      <MemberProfitSummary memberProfits={memberProfits} />
      <section className="panel full-width-panel profits-section profits-members-section">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Members</p>
            <h3>Members Profit</h3>
          </div>
        </div>
        {isAdmin && (
          <div className="profits-encoder-controls">
            <div className="profits-encoder-fields">
              <label>
                Encoder
                <select
                  value={selectedEncoder}
                  onChange={(event) => setSelectedEncoder(event.target.value)}
                  disabled={groupEncoderNames.length === 0}
                >
                  <option value="">Select encoder</option>
                  {groupEncoderNames.map((encoderName) => (
                    <option key={encoderName} value={encoderName}>{encoderName}</option>
                  ))}
                </select>
              </label>
              <label>
                Encoder percentage (%)
                <input
                  type="number"
                  aria-label="Encoder percentage"
                  min="0"
                  max="100"
                  step="0.01"
                  value={encoderPercentage}
                  onChange={(event) => setEncoderPercentage(event.target.value)}
                />
              </label>
            </div>
            <small className="profits-encoder-total">
              {encoderPaymentSent
                ? `Sent: ${formatCurrency(sentEncoderTotal)}`
                : `Total: ${formatCurrency(encoderTotal)}`}
            </small>
            <button
              type="button"
              className="secondary-button member-profit-deduct-button"
              disabled={!canSendToEncoder}
              onClick={() => onSendToEncoder(selectedEncoder, encoderPayments)}
            >
              {encoderPaymentSent ? 'Sent to encoder' : 'Send to encoder'}
            </button>
            {groupEncoderNames.length === 0 && (
              <small className="profits-encoder-note">Add an encoder in Group Updates first.</small>
            )}
            {memberProfitAlreadyPaid && !encoderPaymentSent && (
              <small className="profits-encoder-note">Send the encoder payment before recording member payouts.</small>
            )}
          </div>
        )}
        <div className="stats-grid profits-member-grid">
          {memberProfits.map(({ member, sharePercentage, profitShare }) => {
            const action = memberProfitActions[member.name] ?? 'add to savings'
            const penaltyAmountValue = memberPenaltyAmounts[member.name] ?? ''
            const penaltyAmount = Number(penaltyAmountValue)
            const memberSavings = getMemberSavings(member)
            return (
              <div key={member.name} className="stat-box member-profit-box profits-member-card">
                <span>{member.name}</span>
                <strong>{formatCurrency(profitShare)}</strong>
                <small title="Calculated from savings excluding profits already added to savings">
                  {sharePercentage.toFixed(1)}% savings share
                </small>
                <div className="member-profit-actions">
                  <div className="member-profit-primary-action">
                    <label>
                      Profit action
                      <select
                        value={action}
                        onChange={(event) => {
                          const nextAction = event.target.value as 'add to savings' | 'get profit'
                          setMemberProfitActions((current) => ({ ...current, [member.name]: nextAction }))
                        }}
                      >
                        <option value="add to savings">Add to savings</option>
                        <option value="get profit">Get profit</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="secondary-button member-profit-deduct-button"
                      disabled={profitShare <= 0 || profitShare > memberSavings}
                      onClick={() => onApplyMemberProfitAction(member.name, profitShare, action, profitShare)}
                    >
                      {action === 'add to savings' ? 'Add profit' : 'Get profit'}
                    </button>
                  </div>
                  <div className="member-profit-penalty-action">
                    <label>
                      Penalty amount (PHP)
                      <input
                        type="number"
                        min="0"
                        max={memberSavings}
                        step="any"
                        value={penaltyAmountValue}
                        onChange={(event) => setMemberPenaltyAmounts((current) => ({
                          ...current,
                          [member.name]: event.target.value,
                        }))}
                        placeholder="0"
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary-button member-profit-deduct-button"
                      disabled={profitShare <= 0 || penaltyAmountValue === '' || !Number.isFinite(penaltyAmount) || penaltyAmount <= 0 || penaltyAmount > memberSavings}
                      onClick={() => {
                        onApplyMemberProfitAction(member.name, penaltyAmount, 'penalty', profitShare)
                        setMemberPenaltyAmounts((current) => ({ ...current, [member.name]: '' }))
                      }}
                    >
                      Penalty
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>
      <section className="panel full-width-panel profits-section profits-payouts-section">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Member payouts</p>
            <h3>Profit transactions</h3>
          </div>
          {isAdmin && (isClearConfirmationOpen ? (
            <form
              className="clear-loans-form clear-savings-form"
              noValidate
              onSubmit={(event) => void handleClearProfitTransactions(event)}
            >
              <label>
                Admin password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={clearAdminPassword}
                  onChange={(event) => {
                    setClearAdminPassword(event.target.value)
                    setClearProfitError('')
                  }}
                />
              </label>
              <label>
                Type delete ALL datas
                <input
                  type="text"
                  autoComplete="off"
                  required
                  value={clearConfirmationText}
                  onChange={(event) => {
                    setClearConfirmationText(event.target.value)
                    setClearProfitError('')
                  }}
                />
              </label>
              <button type="submit" className="danger-button" disabled={isClearingProfit}>
                {isClearingProfit ? 'Clearing…' : 'OK'}
              </button>
              <button
                type="button"
                className="secondary-button clear-loans-cancel"
                disabled={isClearingProfit}
                onClick={() => {
                  setIsClearConfirmationOpen(false)
                  setClearAdminPassword('')
                  setClearConfirmationText('')
                  setClearProfitError('')
                }}
              >
                Cancel
              </button>
              {clearProfitError && <p className="clear-loans-error" role="alert">{clearProfitError}</p>}
            </form>
          ) : (
            <button
              type="button"
              className="danger-button"
              onClick={() => setIsClearConfirmationOpen(true)}
            >
              Clear all data
            </button>
          ))}
        </div>
        {profitCashouts.length > 0 ? (
          <ul className="profit-interest-list">
            {[...profitCashouts].sort((first, second) => second.date.localeCompare(first.date)).map((cashout, index) => (
              <li key={`${cashout.memberName}-${cashout.date}-${index}`}>
                <span>{cashout.memberName} · {cashout.action === 'added to savings'
                  ? 'Added to savings'
                  : cashout.action === 'penalty'
                    ? 'Penalty to group allowance'
                    : cashout.action === 'encoder'
                      ? `Sent to encoder${cashout.encoderName ? ` ${cashout.encoderName}` : ''}`
                      : 'Cashout'}</span>
                <strong className={cashout.action === 'added to savings' ? 'positive' : 'negative'}>
                  {cashout.action === 'added to savings' ? '+' : '-'}{formatCurrency(cashout.amount)}
                </strong>
                <time dateTime={cashout.date}>{formatDate(cashout.date)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="savings-history-empty">No profit transactions yet.</p>
        )}
      </section>
    </main>
  )
}

type GroupOperationCost = { id: string; description: string; amount: number; date: string }
type GroupEncoderPayment = {
  id: string
  name: string
  amount?: number
  dateFrom: string
  dateTo: string
  operationCostId?: string
}
type GroupUpdateData = {
  operationCosts: GroupOperationCost[]
  groupEncoders: GroupEncoderPayment[]
  meetingSchedule: string
  meetingPlace: string
  meetingPenalty: number
  boardOfDirectors: string[]
  announcements: GroupAnnouncement[]
}

const GROUP_UPDATE_STORAGE_KEY = 'funds-organizer-group-update-v1'

const emptyGroupUpdateData = (): GroupUpdateData => ({
  operationCosts: [],
  groupEncoders: [],
  meetingSchedule: '',
  meetingPlace: '',
  meetingPenalty: 0,
  boardOfDirectors: [],
  announcements: [],
})

const isGroupUpdateData = (
  value: unknown,
): value is Omit<GroupUpdateData, 'groupEncoders'> & { groupEncoders?: GroupEncoderPayment[] } => {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return Array.isArray(data.operationCosts)
    && data.operationCosts.every((cost) =>
      typeof cost.id === 'string'
      && typeof cost.description === 'string'
      && typeof cost.amount === 'number'
      && Number.isFinite(cost.amount)
      && typeof cost.date === 'string',
    )
    && typeof data.meetingSchedule === 'string'
    && typeof data.meetingPlace === 'string'
    && typeof data.meetingPenalty === 'number'
    && Number.isFinite(data.meetingPenalty)
    && (data.groupEncoders === undefined || (Array.isArray(data.groupEncoders)
      && data.groupEncoders.every((encoder) =>
        typeof encoder.id === 'string'
        && typeof encoder.name === 'string'
        && (encoder.amount === undefined
          || (typeof encoder.amount === 'number' && Number.isFinite(encoder.amount)))
        && typeof encoder.dateFrom === 'string'
        && typeof encoder.dateTo === 'string'
        && (encoder.operationCostId === undefined || typeof encoder.operationCostId === 'string'),
      )))
    && Array.isArray(data.boardOfDirectors)
    && data.boardOfDirectors.every((director) => typeof director === 'string')
    && Array.isArray(data.announcements)
    && data.announcements.every((announcement) =>
      typeof announcement.id === 'string'
      && typeof announcement.title === 'string'
      && typeof announcement.message === 'string'
      && typeof announcement.date === 'string',
    )
}

const loadGroupUpdateData = () => {
  try {
    const savedData = localStorage.getItem(GROUP_UPDATE_STORAGE_KEY)
    if (!savedData) return { data: emptyGroupUpdateData(), error: '' }
    const parsed: unknown = JSON.parse(savedData)
    return isGroupUpdateData(parsed)
      ? { data: { ...parsed, groupEncoders: parsed.groupEncoders ?? [] }, error: '' }
      : { data: emptyGroupUpdateData(), error: 'Saved group update data is invalid and could not be loaded.' }
  } catch (error) {
    return {
      data: emptyGroupUpdateData(),
      error: error instanceof Error
        ? `Could not load group update data: ${error.message}`
        : 'Could not load group update data.',
    }
  }
}

function GroupUpdatePage({ members }: { members: Member[] }) {
  const [loadedData] = useState(loadGroupUpdateData)
  const [data, setData] = useState<GroupUpdateData>(loadedData.data)
  const [storageError, setStorageError] = useState(loadedData.error)
  const [costDescription, setCostDescription] = useState('')
  const [costAmount, setCostAmount] = useState('')
  const [costDate, setCostDate] = useState(getLocalDate)
  const [costError, setCostError] = useState('')
  const [encoderName, setEncoderName] = useState('')
  const [encoderDateFrom, setEncoderDateFrom] = useState(getLocalDate)
  const [encoderDateTo, setEncoderDateTo] = useState(getLocalDate)
  const [encoderError, setEncoderError] = useState('')
  const [editingCostId, setEditingCostId] = useState<string | null>(null)
  const [editCostDescription, setEditCostDescription] = useState('')
  const [editCostAmount, setEditCostAmount] = useState('')
  const [editCostDate, setEditCostDate] = useState('')
  const [editCostError, setEditCostError] = useState('')
  const [meetingError, setMeetingError] = useState('')
  const [directorName, setDirectorName] = useState('')
  const [directorError, setDirectorError] = useState('')
  const [announcementTitle, setAnnouncementTitle] = useState('')
  const [announcementMessage, setAnnouncementMessage] = useState('')
  const [announcementError, setAnnouncementError] = useState('')
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | null>(null)
  const [editAnnouncementTitle, setEditAnnouncementTitle] = useState('')
  const [editAnnouncementMessage, setEditAnnouncementMessage] = useState('')
  const [editAnnouncementError, setEditAnnouncementError] = useState('')

  const updateData = (update: (current: GroupUpdateData) => GroupUpdateData) => {
    const nextData = update(data)
    setData(nextData)
    try {
      localStorage.setItem(GROUP_UPDATE_STORAGE_KEY, JSON.stringify(nextData))
      setStorageError('')
    } catch (error) {
      setStorageError(error instanceof Error
        ? `Could not save group update data: ${error.message}`
        : 'Could not save group update data.')
    }
  }

  const handleAddOperationCost = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const amount = Number(costAmount)
    if (!costDescription.trim()) {
      setCostError('Enter a description for the operating cost.')
      return
    }
    if (costAmount === '' || !Number.isFinite(amount) || amount <= 0) {
      setCostError('Enter an amount greater than zero.')
      return
    }
    if (!costDate) {
      setCostError('Choose a date for this operating cost.')
      return
    }

    updateData((current) => ({
      ...current,
      operationCosts: [{
        id: crypto.randomUUID(),
        description: costDescription.trim(),
        amount,
        date: costDate,
      }, ...current.operationCosts],
    }))
    setCostDescription('')
    setCostAmount('')
    setCostDate(getLocalDate())
    setCostError('')
  }

  const handleAddGroupEncoder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!encoderName.trim()) {
      setEncoderError('Enter an encoder name.')
      return
    }
    if (!encoderDateFrom || !encoderDateTo) {
      setEncoderError('Choose both dates for the payment period.')
      return
    }
    if (encoderDateFrom > encoderDateTo) {
      setEncoderError('The start date must be on or before the end date.')
      return
    }

    const encoderId = crypto.randomUUID()
    const name = encoderName.trim()
    updateData((current) => ({
      ...current,
      groupEncoders: [...current.groupEncoders, {
        id: encoderId,
        name,
        dateFrom: encoderDateFrom,
        dateTo: encoderDateTo,
      }],
    }))
    setEncoderName('')
    setEncoderDateFrom(getLocalDate())
    setEncoderDateTo(getLocalDate())
    setEncoderError('')
  }

  const handleRemoveGroupEncoder = (encoder: GroupEncoderPayment) => {
    updateData((current) => ({
      ...current,
      groupEncoders: current.groupEncoders.filter((item) => item.id !== encoder.id),
      operationCosts: current.operationCosts.filter((cost) => cost.id !== encoder.operationCostId),
    }))
  }

  const handleSaveOperationCost = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const amount = Number(editCostAmount)
    if (!editCostDescription.trim()) {
      setEditCostError('Enter a description for the operating cost.')
      return
    }
    if (editCostAmount === '' || !Number.isFinite(amount) || amount <= 0) {
      setEditCostError('Enter an amount greater than zero.')
      return
    }
    if (!editCostDate) {
      setEditCostError('Choose a date for this operating cost.')
      return
    }

    updateData((current) => ({
      ...current,
      operationCosts: current.operationCosts.map((cost) => cost.id === editingCostId
        ? { ...cost, description: editCostDescription.trim(), amount, date: editCostDate }
        : cost),
    }))
    setEditingCostId(null)
    setEditCostDescription('')
    setEditCostAmount('')
    setEditCostDate('')
    setEditCostError('')
  }

  const handleAddDirector = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = directorName.trim()
    if (!members.some((member) => member.name === name)) {
      setDirectorError('Choose a registered member as director.')
      return
    }
    if (data.boardOfDirectors.some((director) => director.toLowerCase() === name.toLowerCase())) {
      setDirectorError('This director is already listed.')
      return
    }
    updateData((current) => ({ ...current, boardOfDirectors: [...current.boardOfDirectors, name] }))
    setDirectorName('')
    setDirectorError('')
  }

  const handleAddAnnouncement = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!announcementTitle.trim() || !announcementMessage.trim()) {
      setAnnouncementError('Enter a title and announcement.')
      return
    }
    updateData((current) => ({
      ...current,
      announcements: [{
        id: crypto.randomUUID(),
        title: announcementTitle.trim(),
        message: announcementMessage.trim(),
        date: getLocalDate(),
      }, ...current.announcements],
    }))
    setAnnouncementTitle('')
    setAnnouncementMessage('')
    setAnnouncementError('')
  }

  const handleSaveAnnouncement = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editAnnouncementTitle.trim() || !editAnnouncementMessage.trim()) {
      setEditAnnouncementError('Enter a title and announcement.')
      return
    }
    updateData((current) => ({
      ...current,
      announcements: current.announcements.map((announcement) => announcement.id === editingAnnouncementId
        ? { ...announcement, title: editAnnouncementTitle.trim(), message: editAnnouncementMessage.trim() }
        : announcement),
    }))
    setEditingAnnouncementId(null)
    setEditAnnouncementTitle('')
    setEditAnnouncementMessage('')
    setEditAnnouncementError('')
  }

  const totalOperationCosts = data.operationCosts.reduce((total, cost) => total + cost.amount, 0)
  const mapUrl = data.meetingPlace.trim()
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.meetingPlace.trim())}`
    : ''

  return (
    <main className="page-view group-update-page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Group</p>
          <h2>Group Update</h2>
          <p className="group-update-description">Manage group costs, meetings, leadership, and announcements.</p>
        </div>
      </section>
      {storageError && <p className="member-error group-update-error" role="alert">{storageError}</p>}

      <section className="group-update-grid">
        <article className="panel group-update-card">
          <div className="group-update-card-header">
            <div>
              <p className="eyebrow">Finance</p>
              <h3>Group Operation Cost</h3>
            </div>
            <strong className="group-update-total">{formatCurrency(totalOperationCosts)}</strong>
          </div>
          <form className="group-update-form" noValidate onSubmit={handleAddOperationCost}>
            <label>
              Description
              <input value={costDescription} onChange={(event) => setCostDescription(event.target.value)} placeholder="e.g. Meeting supplies" />
            </label>
            <div className="group-update-inline-fields">
              <label>
                Amount (PHP)
                <input type="number" min="0" step="0.01" value={costAmount} onChange={(event) => setCostAmount(event.target.value)} placeholder="0.00" />
              </label>
              <label>
                Date
                <input type="date" value={costDate} onChange={(event) => setCostDate(event.target.value)} />
              </label>
            </div>
            <button type="submit" className="primary-button">Add operation cost</button>
            {costError && <p className="member-error" role="alert">{costError}</p>}
          </form>
          {data.operationCosts.length > 0 ? (
            <ul className="group-update-list">
              {data.operationCosts.map((cost) => (
                <li key={cost.id}>
                  {editingCostId === cost.id ? (
                    <form className="group-update-form group-operation-cost-edit-form" noValidate onSubmit={handleSaveOperationCost}>
                      <label>
                        Description
                        <input value={editCostDescription} onChange={(event) => setEditCostDescription(event.target.value)} />
                      </label>
                      <div className="group-update-inline-fields">
                        <label>
                          Amount (PHP)
                          <input type="number" min="0" step="0.01" value={editCostAmount} onChange={(event) => setEditCostAmount(event.target.value)} />
                        </label>
                        <label>
                          Date
                          <input type="date" value={editCostDate} onChange={(event) => setEditCostDate(event.target.value)} />
                        </label>
                      </div>
                      <div className="group-operation-cost-actions">
                        <button type="submit" className="primary-button">Save</button>
                        <button type="button" className="secondary-button" onClick={() => {
                          setEditingCostId(null)
                          setEditCostError('')
                        }}>Cancel</button>
                      </div>
                      {editCostError && <p className="member-error" role="alert">{editCostError}</p>}
                    </form>
                  ) : (
                    <>
                      <div><strong>{cost.description}</strong><small>{formatDate(cost.date)}</small></div>
                      <span>{formatBorrowerCurrency(cost.amount)}</span>
                      <div className="group-operation-cost-actions">
                        <button type="button" className="secondary-button group-update-remove" onClick={() => {
                          setEditingCostId(cost.id)
                          setEditCostDescription(cost.description)
                          setEditCostAmount(String(cost.amount))
                          setEditCostDate(cost.date)
                          setEditCostError('')
                        }}>Edit</button>
                        <button type="button" className="secondary-button group-update-remove" aria-label={`Remove operation cost ${cost.description}`} onClick={() => updateData((current) => ({
                          ...current,
                          operationCosts: current.operationCosts.filter((item) => item.id !== cost.id),
                        }))}>Remove</button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="group-update-empty">No operation costs recorded.</p>}
        </article>

        <article className="panel group-update-card">
          <div className="group-update-card-header">
            <div>
              <p className="eyebrow">Group payments</p>
              <h3>Group Encoder</h3>
            </div>
          </div>
          <form className="group-update-form" noValidate onSubmit={handleAddGroupEncoder}>
            <label>
              Encoder name
              <input value={encoderName} onChange={(event) => setEncoderName(event.target.value)} placeholder="Enter a name" />
            </label>
            <div className="group-update-inline-fields">
              <label>
                From
                <input type="date" value={encoderDateFrom} onChange={(event) => setEncoderDateFrom(event.target.value)} />
              </label>
              <label>
                To
                <input type="date" value={encoderDateTo} onChange={(event) => setEncoderDateTo(event.target.value)} />
              </label>
            </div>
            <button type="submit" className="primary-button">Add encoder</button>
            {encoderError && <p className="member-error" role="alert">{encoderError}</p>}
          </form>
          {data.groupEncoders.length > 0 ? (
            <ul className="group-update-list">
              {data.groupEncoders.map((encoder) => (
                <li key={encoder.id}>
                  <div>
                    <strong>{encoder.name}</strong>
                    <small>{formatDate(encoder.dateFrom)} to {formatDate(encoder.dateTo)}</small>
                  </div>
                  <button type="button" className="secondary-button group-update-remove" aria-label={`Remove encoder ${encoder.name}`} onClick={() => handleRemoveGroupEncoder(encoder)}>Remove</button>
                </li>
              ))}
            </ul>
          ) : <p className="group-update-empty">No encoder payments recorded.</p>}
        </article>

        <article className="panel group-update-card">
          <div className="group-update-card-header">
            <div>
              <p className="eyebrow">Schedule</p>
              <h3>Meeting</h3>
            </div>
          </div>
          <div className="group-update-form">
            <label>
              Schedule
              <input
                type="datetime-local"
                value={data.meetingSchedule}
                onChange={(event) => updateData((current) => ({ ...current, meetingSchedule: event.target.value }))}
              />
            </label>
            <label>
              Place
              <input
                value={data.meetingPlace}
                onChange={(event) => updateData((current) => ({ ...current, meetingPlace: event.target.value }))}
                placeholder="Enter meeting address or place"
              />
            </label>
            <label>
              Penalty for not attending (PHP)
              <input
                type="number"
                min="0"
                step="0.01"
                value={data.meetingPenalty}
                onChange={(event) => {
                  const penalty = Number(event.target.value)
                  if (!Number.isFinite(penalty) || penalty < 0) {
                    setMeetingError('Meeting penalty must be zero or greater.')
                    return
                  }
                  setMeetingError('')
                  updateData((current) => ({ ...current, meetingPenalty: penalty }))
                }}
              />
            </label>
            <div className="group-update-actions">
              {mapUrl && <a className="secondary-button group-update-map-link" href={mapUrl} target="_blank" rel="noreferrer">Open map</a>}
              <small>Meeting details save automatically.</small>
            </div>
            {meetingError && <p className="member-error" role="alert">{meetingError}</p>}
          </div>
          {data.meetingSchedule && (
            <p className="group-update-meeting-preview">
              Next meeting: {new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.meetingSchedule))}
            </p>
          )}
        </article>

        <article className="panel group-update-card">
          <div className="group-update-card-header">
            <div>
              <p className="eyebrow">Leadership</p>
              <h3>Board of Directors</h3>
            </div>
          </div>
          <form className="group-update-form" noValidate onSubmit={handleAddDirector}>
            <label>
              Choose a member
              <select
                value={directorName}
                onChange={(event) => {
                  setDirectorName(event.target.value)
                  setDirectorError('')
                }}
                required
              >
                <option value="">Select a registered member</option>
                {members.map((member) => (
                  <option key={member.name} value={member.name}>{member.name}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="primary-button" disabled={members.length === 0}>Add director</button>
            {members.length === 0 && <p className="group-update-empty">Add a member before assigning a director.</p>}
            {directorError && <p className="member-error" role="alert">{directorError}</p>}
          </form>
          {data.boardOfDirectors.length > 0 ? (
            <ul className="group-update-list">
              {data.boardOfDirectors.map((director) => (
                <li key={director}>
                  <strong>{director}</strong>
                  <button type="button" className="secondary-button group-update-remove" aria-label={`Remove ${director}`} onClick={() => updateData((current) => ({
                    ...current,
                    boardOfDirectors: current.boardOfDirectors.filter((name) => name !== director),
                  }))}>Remove</button>
                </li>
              ))}
            </ul>
          ) : <p className="group-update-empty">No directors listed.</p>}
        </article>

        <article className="panel group-update-card">
          <div className="group-update-card-header">
            <div>
              <p className="eyebrow">Updates</p>
              <h3>Announcements</h3>
            </div>
          </div>
          <form className="group-update-form" noValidate onSubmit={handleAddAnnouncement}>
            <label>
              Title
              <input value={announcementTitle} onChange={(event) => setAnnouncementTitle(event.target.value)} placeholder="Announcement title" />
            </label>
            <label>
              Announcement
              <textarea value={announcementMessage} onChange={(event) => setAnnouncementMessage(event.target.value)} placeholder="Write an update for the group" rows={3} />
            </label>
            <button type="submit" className="primary-button">Post announcement</button>
            {announcementError && <p className="member-error" role="alert">{announcementError}</p>}
          </form>
          {data.announcements.length > 0 ? (
            <ul className="group-update-list group-announcement-list">
              {data.announcements.map((announcement) => (
                <li key={announcement.id}>
                  {editingAnnouncementId === announcement.id ? (
                    <form className="group-update-form group-announcement-edit-form" noValidate onSubmit={handleSaveAnnouncement}>
                      <label>
                        Title
                        <input value={editAnnouncementTitle} onChange={(event) => setEditAnnouncementTitle(event.target.value)} />
                      </label>
                      <label>
                        Announcement
                        <textarea value={editAnnouncementMessage} onChange={(event) => setEditAnnouncementMessage(event.target.value)} rows={3} />
                      </label>
                      <div className="group-announcement-actions">
                        <button type="submit" className="primary-button">Save</button>
                        <button type="button" className="secondary-button" onClick={() => {
                          setEditingAnnouncementId(null)
                          setEditAnnouncementError('')
                        }}>Cancel</button>
                      </div>
                      {editAnnouncementError && <p className="member-error" role="alert">{editAnnouncementError}</p>}
                    </form>
                  ) : (
                    <>
                      <div>
                        <strong>{announcement.title}</strong>
                        <small>{formatDate(announcement.date)}</small>
                        <p>{announcement.message}</p>
                      </div>
                      <div className="group-announcement-actions">
                        <button type="button" className="secondary-button group-update-remove" onClick={() => {
                          setEditingAnnouncementId(announcement.id)
                          setEditAnnouncementTitle(announcement.title)
                          setEditAnnouncementMessage(announcement.message)
                          setEditAnnouncementError('')
                        }}>Edit</button>
                        <button type="button" className="secondary-button group-update-remove" aria-label={`Remove announcement ${announcement.title}`} onClick={() => updateData((current) => ({
                          ...current,
                          announcements: current.announcements.filter((item) => item.id !== announcement.id),
                        }))}>Remove</button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="group-update-empty">No announcements posted.</p>}
        </article>
      </section>
    </main>
  )
}

type DataPageProps = {
  borrowers: Borrower[]
  onExportOverview: (adminPassword: string) => Promise<void>
  onExportSavings: (adminPassword: string) => Promise<void>
  onExportLoans: (adminPassword: string) => Promise<void>
  onExportProfits: (adminPassword: string) => Promise<void>
}

function DataPage({
  borrowers,
  onExportOverview,
  onExportSavings,
  onExportLoans,
  onExportProfits,
}: DataPageProps) {
  const activeLoans = borrowers.filter((borrower) =>
    hasOutstandingBorrowerBalance(borrower.loanAmount)
    || hasOutstandingBorrowerBalance(borrower.paydayInterest),
  )
  const inactiveLoans = borrowers.filter((borrower) =>
    !hasOutstandingBorrowerBalance(borrower.loanAmount)
    && !hasOutstandingBorrowerBalance(borrower.paydayInterest),
  )
  const [exportingData, setExportingData] = useState('')
  const [exportError, setExportError] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [selectedExport, setSelectedExport] = useState<{
    label: string
    exportData: (password: string) => Promise<void>
  } | null>(null)
  const handleExport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedExport || !adminPassword) {
      setExportError('Enter the admin password to export data.')
      return
    }
    setExportingData(selectedExport.label)
    setExportError('')
    try {
      await selectedExport.exportData(adminPassword)
      setAdminPassword('')
      setSelectedExport(null)
    } catch (error) {
      setExportError(error instanceof Error
        ? error.message
        : `Could not export ${selectedExport.label.toLowerCase()} data.`)
    } finally {
      setAdminPassword('')
      setExportingData('')
    }
  }

  return (
    <main className="page-view data-export-page">
      <section className="panel full-width-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Export</p>
            <h2>Download data</h2>
          </div>
        </div>
        <div className="stats-grid">
          <button type="button" className="secondary-button" disabled={Boolean(exportingData)} onClick={() => {
            setSelectedExport({ label: 'Overview', exportData: onExportOverview })
            setAdminPassword('')
            setExportError('')
          }}>
            {exportingData === 'Overview' ? 'Exporting…' : 'Export overview data'}
          </button>
          <button type="button" className="secondary-button" disabled={Boolean(exportingData)} onClick={() => {
            setSelectedExport({ label: 'Savings', exportData: onExportSavings })
            setAdminPassword('')
            setExportError('')
          }}>
            {exportingData === 'Savings' ? 'Exporting…' : 'Export savings data'}
          </button>
          <button type="button" className="secondary-button" disabled={Boolean(exportingData)} onClick={() => {
            setSelectedExport({ label: 'Loans', exportData: onExportLoans })
            setAdminPassword('')
            setExportError('')
          }}>
            {exportingData === 'Loans' ? 'Exporting…' : 'Export loans data'}
          </button>
          <button type="button" className="secondary-button" disabled={Boolean(exportingData)} onClick={() => {
            setSelectedExport({ label: 'Profits', exportData: onExportProfits })
            setAdminPassword('')
            setExportError('')
          }}>
            {exportingData === 'Profits' ? 'Exporting…' : 'Export profit data'}
          </button>
        </div>
        {exportError && <p className="member-error" role="alert">{exportError}</p>}
      </section>
      <section className="panel full-width-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Loans</p>
            <h2>Loan status</h2>
          </div>
        </div>
        <div className="borrower-groups data-loan-groups">
          {[
            { title: 'Active loans', items: activeLoans },
            { title: 'Inactive loans', items: inactiveLoans },
          ].map(({ title, items }) => (
            <section key={title} className="borrower-group" aria-label={title}>
              <div className="borrower-group-heading">
                <h4>{title}</h4>
                <span>{items.length}</span>
              </div>
              {items.length > 0 ? (
                <ul className="borrower-list">
                  {items.map((borrower) => (
                    <li key={borrower.id} className="borrower-item">
                      <div className="borrower-item-header">
                        <div className="borrower-name-principal">
                          <strong>{borrower.name}</strong>
                          {borrower.guarantorName && <span>Guarantor: {borrower.guarantorName}</span>}
                        </div>
                      </div>
                      <div className="borrower-metrics">
                        <span className="borrower-metric principal-metric"><strong>Principal:</strong> {formatBorrowerCurrency(borrower.loanAmount)}</span>
                        <span className="borrower-metric interest-metric"><strong>Interest due:</strong> {formatBorrowerCurrency(borrower.paydayInterest)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="savings-history-empty">No {title.toLowerCase()}.</p>
              )}
            </section>
          ))}
        </div>
      </section>
      {selectedExport && (
        <div className="login-overlay" onClick={(event) => {
          if (event.target === event.currentTarget && !exportingData) {
            setSelectedExport(null)
            setAdminPassword('')
            setExportError('')
          }
        }}>
          <section className="login-dialog" role="dialog" aria-modal="true" aria-labelledby="export-password-title">
            <div className="login-dialog-header">
              <div>
                <p className="eyebrow">Protected export</p>
                <h2 id="export-password-title">Export {selectedExport.label} data</h2>
              </div>
              <button type="button" className="login-close-button" aria-label="Cancel export" disabled={Boolean(exportingData)} onClick={() => {
                setSelectedExport(null)
                setAdminPassword('')
                setExportError('')
              }}>×</button>
            </div>
            <form className="login-form" noValidate onSubmit={(event) => void handleExport(event)}>
              <label>
                Admin password
                <input
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  required
                  value={adminPassword}
                  onChange={(event) => {
                    setAdminPassword(event.target.value)
                    setExportError('')
                  }}
                />
              </label>
              <button type="submit" className="primary-button" disabled={Boolean(exportingData)}>
                {exportingData ? 'Verifying…' : `Export ${selectedExport.label.toLowerCase()} data`}
              </button>
              <button type="button" className="secondary-button" disabled={Boolean(exportingData)} onClick={() => {
                setSelectedExport(null)
                setAdminPassword('')
                setExportError('')
              }}>Cancel</button>
              {exportError && <p className="member-error" role="alert">{exportError}</p>}
            </form>
          </section>
        </div>
      )}
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
  const [deletedSavingsTransactions, setDeletedSavingsTransactions] = useState<DeletedSavingsTransaction[]>(loadSavedDeletedSavingsTransactions)
  const [deletedProfitTransactions, setDeletedProfitTransactions] = useState<DeletedProfitTransaction[]>(loadSavedDeletedProfitTransactions)
  const [deletedLoans, setDeletedLoans] = useState<DeletedLoanRecord[]>(loadSavedDeletedLoans)
  const [accounts, setAccounts] = useState<DatabaseAccount[]>([])
  const [borrowers, setBorrowers] = useState<Borrower[]>([])
  const [removedBorrowerTransactions, setRemovedBorrowerTransactions] = useState<RemovedBorrowerTransaction[]>([])
  const [profitTransfers, setProfitTransfers] = useState<ProfitTransfer[]>([])
  const [otherProfits, setOtherProfits] = useState<OtherProfit[]>(loadSavedOtherProfits)
  const [profitCashouts, setProfitCashouts] = useState<ProfitCashout[]>(loadSavedProfitCashouts)
  const [lastTransactionUndo, setLastTransactionUndo] = useState<{
    label: string
    snapshot: TransactionUndoSnapshot
  } | null>(null)
  const [isUndoPasswordOpen, setIsUndoPasswordOpen] = useState(false)
  const [undoAdminPassword, setUndoAdminPassword] = useState('')
  const [undoPasswordError, setUndoPasswordError] = useState('')
  const [isVerifyingUndoPassword, setIsVerifyingUndoPassword] = useState(false)
  const [signedInUser, setSignedInUser] = useState('')
  const [signedInEmail, setSignedInEmail] = useState('')
  const [signedInRole, setSignedInRole] = useState<AccountRole | null>(null)
  const [selectedMember, setSelectedMember] = useState('all')
  const [databaseMessage, setDatabaseMessage] = useState('Loading saved data…')
  const [isDatabaseConnecting, setIsDatabaseConnecting] = useState(false)
  const [canChooseDatabaseFolder, setCanChooseDatabaseFolder] = useState(supportsDatabaseFolder)
  const databaseDirectory = useRef<DatabaseDirectoryHandle | null>(null)
  const initialMembers = useRef(members)
  const initialDeletedSavingsTransactions = useRef(deletedSavingsTransactions)
  const initialDeletedProfitTransactions = useRef(deletedProfitTransactions)
  const initialDeletedLoans = useRef(deletedLoans)
  const initialAccounts = useRef(accounts)
  const initialBorrowers = useRef(borrowers)
  const initialRemovedBorrowerTransactions = useRef(removedBorrowerTransactions)
  const initialProfitTransfers = useRef(profitTransfers)
  const initialOtherProfits = useRef(otherProfits)
  const initialProfitCashouts = useRef(profitCashouts)
  const rememberTransactionUndo = (label: string) => {
    setIsUndoPasswordOpen(false)
    setUndoAdminPassword('')
    setUndoPasswordError('')
    setLastTransactionUndo({
      label,
      snapshot: {
        members,
        accounts,
        borrowers,
        removedBorrowerTransactions,
        profitTransfers,
        otherProfits,
        profitCashouts,
      },
    })
  }
  const undoLastTransaction = () => {
    if (!lastTransactionUndo) return
    const { snapshot } = lastTransactionUndo
    setMembers(snapshot.members)
    setAccounts(snapshot.accounts)
    setBorrowers(snapshot.borrowers)
    setRemovedBorrowerTransactions(snapshot.removedBorrowerTransactions)
    setProfitTransfers(snapshot.profitTransfers)
    setOtherProfits(snapshot.otherProfits)
    setProfitCashouts(snapshot.profitCashouts)
    setLastTransactionUndo(null)
  }
  const handleUndoSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (signedInRole !== 'admin' || !lastTransactionUndo) return
    const adminAccount = accounts.find((account) =>
      account.role === 'admin'
      && account.email.trim().toLowerCase() === signedInEmail.trim().toLowerCase(),
    )
    if (!adminAccount) {
      setUndoPasswordError('The logged-in admin account could not be verified.')
      return
    }

    setIsVerifyingUndoPassword(true)
    setUndoPasswordError('')
    try {
      if (!(await verifyPassword(undoAdminPassword, adminAccount))) {
        setUndoPasswordError('The admin password is incorrect.')
        return
      }
      undoLastTransaction()
      setIsUndoPasswordOpen(false)
      setUndoAdminPassword('')
    } catch (error) {
      setUndoPasswordError(error instanceof Error ? error.message : 'Could not verify the admin password.')
    } finally {
      setIsVerifyingUndoPassword(false)
    }
  }
  const closeUndoPasswordDialog = () => {
    if (isVerifyingUndoPassword) return
    setIsUndoPasswordOpen(false)
    setUndoAdminPassword('')
    setUndoPasswordError('')
  }
  const totalSavings = members.reduce((total, member) => total + getMemberSavings(member), 0)
  const totalLoanProceeds = borrowers.reduce((total, borrower) => total + borrower.loanAmount, 0)
  const totalInterestPaid = getTotalInterestPaid(borrowers, removedBorrowerTransactions)
  const totalOtherProfit = otherProfits.reduce((total, profit) => total + profit.amount, 0)
  const monthlyNetProfit = getMonthlyNetProfit(borrowers, removedBorrowerTransactions, otherProfits, currentYear)
  const totalReceivableInterest = borrowers.reduce((total, borrower) => total + borrower.paydayInterest, 0)
  const totalGroupAllowance = members.reduce((total, member) => total + member.withdrawals.reduce(
    (memberTotal, withdrawal) => memberTotal + (withdrawal.reason === 'Profit penalty' ? withdrawal.amount : withdrawal.amount * 0.1),
    0,
  ), 0)
  const cashOutTransactions = getOverviewCashOutTransactions(members, borrowers, profitCashouts)
  const cashInTransactions = getOverviewCashInTransactions(members, borrowers, removedBorrowerTransactions, otherProfits)
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
          setLastTransactionUndo(null)
          setMembers(syncAccountMembers(workbookData.accounts, workbookData.members))
          setDeletedSavingsTransactions(workbookData.deletedSavingsTransactions.length > 0
            ? workbookData.deletedSavingsTransactions
            : initialDeletedSavingsTransactions.current)
          setAccounts(workbookData.accounts)
          setBorrowers(workbookData.borrowers)
          setRemovedBorrowerTransactions(workbookData.removedBorrowerTransactions)
          setProfitTransfers(workbookData.profitTransfers)
          setOtherProfits(workbookData.otherProfits ?? initialOtherProfits.current)
          setProfitCashouts(workbookData.profitCashouts)
          setDeletedProfitTransactions(workbookData.deletedProfitTransactions.length > 0
            ? workbookData.deletedProfitTransactions
            : initialDeletedProfitTransactions.current)
          setDeletedLoans(workbookData.deletedLoans.length > 0
            ? workbookData.deletedLoans
            : initialDeletedLoans.current)
        } else {
          await writeWorkbookData(directory, initialMembers.current, initialAccounts.current, initialBorrowers.current, initialRemovedBorrowerTransactions.current, initialProfitTransfers.current, initialProfitCashouts.current, initialDeletedSavingsTransactions.current, initialDeletedProfitTransactions.current, initialDeletedLoans.current, initialOtherProfits.current)
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
    saveProfitCashoutsLocally(profitCashouts)
    saveOtherProfitsLocally(otherProfits)
    saveDeletedSavingsTransactionsLocally(deletedSavingsTransactions)
    saveDeletedProfitTransactionsLocally(deletedProfitTransactions)
    saveDeletedLoansLocally(deletedLoans)
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
        await writeWorkbookData(directory, members, accounts, borrowers, removedBorrowerTransactions, profitTransfers, profitCashouts, deletedSavingsTransactions, deletedProfitTransactions, deletedLoans, otherProfits)
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
  }, [members, accounts, borrowers, removedBorrowerTransactions, profitTransfers, profitCashouts, deletedSavingsTransactions, deletedProfitTransactions, deletedLoans, otherProfits])

  const handleChooseDatabaseFolder = async () => {
    setIsDatabaseConnecting(true)
    try {
      const directory = await chooseDatabaseDirectory()
      const workbookData = await readWorkbookData(directory)
      let connectedMembers = members
      let connectedAccounts = accounts
      let connectedBorrowers = borrowers
      let connectedRemovedBorrowerTransactions = removedBorrowerTransactions
      let connectedProfitTransfers = profitTransfers
      let connectedOtherProfits = otherProfits
      let connectedProfitCashouts = profitCashouts
      let connectedDeletedSavingsTransactions = deletedSavingsTransactions
      let connectedDeletedProfitTransactions = deletedProfitTransactions
      let connectedDeletedLoans = deletedLoans
      if (workbookData) {
        connectedMembers = syncAccountMembers(workbookData.accounts, workbookData.members)
        connectedAccounts = workbookData.accounts
        connectedBorrowers = workbookData.borrowers
        connectedRemovedBorrowerTransactions = workbookData.removedBorrowerTransactions
        connectedProfitTransfers = workbookData.profitTransfers
        connectedOtherProfits = workbookData.otherProfits ?? otherProfits
        connectedProfitCashouts = workbookData.profitCashouts
        connectedDeletedSavingsTransactions = workbookData.deletedSavingsTransactions.length > 0
          ? workbookData.deletedSavingsTransactions
          : deletedSavingsTransactions
        connectedDeletedProfitTransactions = workbookData.deletedProfitTransactions.length > 0
          ? workbookData.deletedProfitTransactions
          : deletedProfitTransactions
        connectedDeletedLoans = workbookData.deletedLoans.length > 0
          ? workbookData.deletedLoans
          : deletedLoans
      } else {
        await writeWorkbookData(directory, connectedMembers, connectedAccounts, connectedBorrowers, connectedRemovedBorrowerTransactions, connectedProfitTransfers, connectedProfitCashouts, connectedDeletedSavingsTransactions, connectedDeletedProfitTransactions, connectedDeletedLoans, connectedOtherProfits)
      }
      await saveDirectory(directory)
      databaseDirectory.current = directory
      setLastTransactionUndo(null)
      setMembers(connectedMembers)
      setAccounts(connectedAccounts)
      setBorrowers(connectedBorrowers)
      setRemovedBorrowerTransactions(connectedRemovedBorrowerTransactions)
      setProfitTransfers(connectedProfitTransfers)
      setOtherProfits(connectedOtherProfits)
      setProfitCashouts(connectedProfitCashouts)
      setDeletedSavingsTransactions(connectedDeletedSavingsTransactions)
      setDeletedProfitTransactions(connectedDeletedProfitTransactions)
      setDeletedLoans(connectedDeletedLoans)
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
      const savedProfitTransfers = workbookData?.profitTransfers ?? profitTransfers
      const savedOtherProfits = workbookData?.otherProfits ?? otherProfits
      const savedProfitCashouts = workbookData?.profitCashouts ?? profitCashouts
      const savedDeletedSavingsTransactions = workbookData?.deletedSavingsTransactions.length
        ? workbookData.deletedSavingsTransactions
        : deletedSavingsTransactions
      const savedDeletedProfitTransactions = workbookData?.deletedProfitTransactions.length
        ? workbookData.deletedProfitTransactions
        : deletedProfitTransactions
      const savedDeletedLoans = workbookData?.deletedLoans.length
        ? workbookData.deletedLoans
        : deletedLoans
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
        await writeWorkbookData(directory, updatedMembers, updatedAccounts, savedBorrowers, savedRemovedBorrowerTransactions, savedProfitTransfers, savedProfitCashouts, savedDeletedSavingsTransactions, savedDeletedProfitTransactions, savedDeletedLoans, savedOtherProfits)
        setMembers(updatedMembers)
        setAccounts(updatedAccounts)
        setBorrowers(savedBorrowers)
        setRemovedBorrowerTransactions(savedRemovedBorrowerTransactions)
        setProfitTransfers(savedProfitTransfers)
        setOtherProfits(savedOtherProfits)
        setProfitCashouts(savedProfitCashouts)
        setDeletedSavingsTransactions(savedDeletedSavingsTransactions)
        setDeletedProfitTransactions(savedDeletedProfitTransactions)
        setDeletedLoans(savedDeletedLoans)
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
        setProfitTransfers(savedProfitTransfers)
        setOtherProfits(savedOtherProfits)
        setProfitCashouts(savedProfitCashouts)
        setDeletedSavingsTransactions(savedDeletedSavingsTransactions)
        setDeletedProfitTransactions(savedDeletedProfitTransactions)
        setDeletedLoans(savedDeletedLoans)
        setSignedInUser(account.name)
        setSignedInEmail(account.email)
        setSignedInRole(account.role)
      }

      setLastTransactionUndo(null)
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

  const addSavings = (
    memberName: string,
    amount: number,
    date: string,
    source?: 'member profit',
    shouldRememberUndo = true,
  ) => {
    const canEditMemberSavings = (member: Member) =>
      signedInRole === 'admin'
      || (signedInRole === 'member'
        && Boolean(signedInEmail.trim())
        && member.accountEmail?.trim().toLowerCase() === signedInEmail.trim().toLowerCase())
    const member = members.find((candidate) => candidate.name === memberName)
    if (!member || !canEditMemberSavings(member) || !Number.isFinite(amount) || amount <= 0 || !date) return
    if (shouldRememberUndo) rememberTransactionUndo(source ? 'profit added to savings' : 'savings contribution')
    setMembers((currentMembers) =>
      currentMembers.map((member) =>
        member.name === memberName && canEditMemberSavings(member)
          ? { ...member, contributions: [...member.contributions, { amount, date, source, recordedBy: signedInUser || undefined }] }
          : member,
      ),
    )
  }

  const addOtherProfit = (profit: OtherProfit) => {
    if (signedInRole !== 'admin') return
    rememberTransactionUndo('other profit')
    setOtherProfits((currentProfits) => [...currentProfits, profit])
  }

  const addMemberAccount = async (
    name: string,
    initialSavings: number,
    initialSavingsDate: string,
    email: string,
    password: string,
  ) => {
    if (signedInRole !== 'admin') {
      return { success: false, message: 'Only an admin can add a member account.' }
    }
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedName = name.trim()
    if (!normalizedName || !normalizedEmail || password.length < 8
      || !Number.isFinite(initialSavings) || initialSavings < 0 || !initialSavingsDate) {
      return { success: false, message: 'Enter valid member details and a password of at least 8 characters.' }
    }
    if (accounts.some((account) => account.email.trim().toLowerCase() === normalizedEmail)) {
      return { success: false, message: 'An account with that email already exists.' }
    }
    if (members.some((member) => member.name.trim().toLowerCase() === normalizedName.toLowerCase())) {
      return { success: false, message: 'A member with that name already exists.' }
    }
    const directory = databaseDirectory.current
    if (!directory) {
      return { success: false, message: 'Connect the Excel database folder before adding a member.' }
    }

    const permission = await directory.queryPermission({ mode: 'readwrite' })
    if (permission !== 'granted') {
      return { success: false, message: 'Reconnect the Excel database folder before adding a member.' }
    }

    const { salt, passwordHash } = await createPasswordHash(password)
    const account: DatabaseAccount = {
      email: normalizedEmail,
      name: normalizedName,
      role: 'member',
      salt,
      passwordHash,
      createdAt: new Date().toISOString(),
    }
    const member: Member = {
      name: normalizedName,
      accountEmail: normalizedEmail,
      initialSavings,
      initialSavingsDate,
      contributions: [],
      withdrawals: [],
      adjustments: [],
    }
    const updatedMembers = [...members, member]
    const updatedAccounts = [...accounts, account]
    await writeWorkbookData(
      directory,
      updatedMembers,
      updatedAccounts,
      borrowers,
      removedBorrowerTransactions,
      profitTransfers,
      profitCashouts,
      deletedSavingsTransactions,
      deletedProfitTransactions,
      deletedLoans,
      otherProfits,
    )
    setMembers(updatedMembers)
    setAccounts(updatedAccounts)
    if (initialSavings > 0) rememberTransactionUndo('new member savings')
    else setLastTransactionUndo(null)
    setDatabaseMessage(`Excel database connected: ${directory.name}`)
    return { success: true }
  }

  const editMemberSavings = (memberName: string, amount: number, reason: string, date: string) => {
    if (signedInRole !== 'admin' || !Number.isFinite(amount) || amount < 0
      || !Number.isSafeInteger(Math.round(amount * 100)) || !reason.trim() || !date) return
    const newAmount = Number(amount.toFixed(2))
    const member = members.find((candidate) => candidate.name === memberName)
    if (!member || Number(getMemberSavings(member).toFixed(2)) === newAmount) return
    rememberTransactionUndo('savings adjustment')
    setMembers((currentMembers) => currentMembers.map((member) => {
      if (member.name !== memberName) return member
      const previousAmount = Number(getMemberSavings(member).toFixed(2))
      if (previousAmount === newAmount) return member
      return {
        ...member,
        adjustments: [...(member.adjustments ?? []), {
          id: crypto.randomUUID(),
          previousAmount,
          newAmount,
          date,
          reason: reason.trim(),
        }],
      }
    }))
  }

  const applyMemberProfitAction = (
    memberName: string,
    amount: number,
    action: 'add to savings' | 'get profit' | 'penalty',
    memberProfit: number,
  ) => {
    const member = members.find((candidate) => candidate.name === memberName)
    if (!member || !Number.isFinite(amount) || amount <= 0 || amount > getMemberSavings(member)) return
    if (action === 'penalty' && (!Number.isFinite(memberProfit) || memberProfit <= 0)) return

    const date = getLocalDate()
    const transferTotal = Number(profitTransfers.reduce((total, transfer) => total + transfer.amount, 0).toFixed(2))
    if (action === 'add to savings') {
      rememberTransactionUndo('profit added to savings')
      addSavings(memberName, amount, date, 'member profit', false)
      setProfitCashouts((currentCashouts) => [...currentCashouts, {
        memberName,
        amount,
        date,
        action: 'added to savings',
        transferTotal,
      }])
      return
    }

    if (action === 'get profit') {
      rememberTransactionUndo('profit cashout')
      setProfitCashouts((currentCashouts) => [...currentCashouts, {
        memberName,
        amount,
        date,
        action: 'cashout',
        transferTotal,
      }])
      return
    }
    const canEditMemberSavings = signedInRole === 'admin'
      || (signedInRole === 'member'
        && Boolean(signedInEmail.trim())
        && member.accountEmail?.trim().toLowerCase() === signedInEmail.trim().toLowerCase())
    if (!canEditMemberSavings) return
    rememberTransactionUndo('profit penalty')
    pullOutSavings(memberName, amount, date, 'Profit penalty', false)
    setProfitCashouts((currentCashouts) => [...currentCashouts, {
      memberName,
      amount,
      date,
      action: 'penalty',
      transferTotal,
    }])
  }

  const sendProfitToEncoder = (
    encoderName: string,
    payments: Array<{ memberName: string; amount: number }>,
  ) => {
    if (signedInRole !== 'admin' || !encoderName.trim() || payments.length === 0
      || payments.some((payment) => !payment.memberName.trim()
        || !Number.isFinite(payment.amount) || payment.amount <= 0)) return
    const transferTotal = Number(profitTransfers.reduce((total, transfer) => total + transfer.amount, 0).toFixed(2))
    if (profitCashouts.some((cashout) =>
      cashout.transferTotal === transferTotal
      && cashout.action !== 'penalty')) return
    const date = getLocalDate()
    const payouts = payments.map(({ memberName, amount }) => ({
      memberName,
      amount,
      date,
      action: 'encoder' as const,
      transferTotal,
      encoderName: encoderName.trim(),
    }))
    rememberTransactionUndo('encoder payouts')
    setProfitCashouts((currentCashouts) => {
      if (currentCashouts.some((cashout) =>
        cashout.transferTotal === transferTotal
        && cashout.action !== 'penalty')) return currentCashouts
      return [...currentCashouts, ...payouts]
    })
  }

  const transferProfit = (dateFrom: string, dateTo: string) => {
    if (signedInRole !== 'admin') return
    const createTransfer = (currentTransfers: ProfitTransfer[]) => {
      const transferred = currentTransfers.reduce((total, transfer) => total + transfer.amount, 0)
      let balance = Number(Math.max(0, totalInterestPaid + totalOtherProfit - transferred).toFixed(2))
      const allocatedByPayment = new Map<string, number>()
      currentTransfers.forEach((transfer) => transfer.paymentAllocations?.forEach((allocation) => {
        allocatedByPayment.set(
          allocation.transactionId,
          (allocatedByPayment.get(allocation.transactionId) ?? 0) + allocation.amount,
        )
      }))
      const eligiblePayments = [
        ...borrowers.flatMap((borrower) => (borrower.transactions ?? [])
          .filter((transaction) => transaction.type === 'interest-payment')
          .map((transaction) => ({
            transactionId: `${borrower.id}-${transaction.id}`,
            amount: transaction.amount,
            date: transaction.date,
          }))),
        ...removedBorrowerTransactions
          .filter(({ transaction }) => transaction.type === 'interest-payment')
          .map(({ borrowerId, transaction }) => ({
            transactionId: `${borrowerId}-${transaction.id}`,
            amount: transaction.amount,
            date: transaction.date,
          })),
        ...otherProfits.map((profit) => ({
          transactionId: `other-profit-${profit.id}`,
          amount: profit.amount,
          date: profit.date,
        })),
      ].filter((payment) => payment.date >= dateFrom && payment.date <= dateTo)
        .sort((first, second) => first.date.localeCompare(second.date))
      const paymentAllocations: Array<{ transactionId: string; amount: number }> = []
      eligiblePayments.forEach((payment) => {
        if (balance <= 0) return
        const availableAmount = Math.max(0, payment.amount - (allocatedByPayment.get(payment.transactionId) ?? 0))
        const amount = Number(Math.min(availableAmount, balance).toFixed(2))
        if (amount <= 0) return
        paymentAllocations.push({ transactionId: payment.transactionId, amount })
        balance = Number((balance - amount).toFixed(2))
      })
      const amount = paymentAllocations.reduce((total, allocation) => total + allocation.amount, 0)
      return amount > 0
        ? {
          amount,
          date: getLocalDate(),
          periodFrom: dateFrom,
          periodTo: dateTo,
          paymentAllocations,
        }
        : null
    }
    if (!createTransfer(profitTransfers)) return
    rememberTransactionUndo('profit transfer')
    setProfitTransfers((currentTransfers) => {
      const transfer = createTransfer(currentTransfers)
      return transfer ? [...currentTransfers, transfer] : currentTransfers
    })
  }

  const pullOutSavings = (
    memberName: string,
    amount: number,
    date: string,
    reason: string,
    shouldRememberUndo = true,
  ) => {
    if (signedInRole !== 'admin') return
    const amountInCents = Math.round(amount * 100)
    const member = members.find((candidate) => candidate.name === memberName)
    if (!member || !Number.isFinite(amount) || amountInCents <= 0
      || amountInCents > Math.round(getMemberSavings(member) * 100)) return
    if (shouldRememberUndo) rememberTransactionUndo('savings withdrawal')
    setMembers((currentMembers) =>
      currentMembers.map((member) =>
        member.name === memberName
        && Number.isFinite(amount)
        && amountInCents > 0
        && amountInCents <= Math.round(getMemberSavings(member) * 100)
          ? { ...member, withdrawals: [...member.withdrawals, { amount: amountInCents / 100, date, reason, recordedBy: signedInUser || undefined }] }
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

    setLastTransactionUndo(null)
    setMembers((currentMembers) => currentMembers.filter((member) => member.name !== memberName))
    if (linkedAccount) {
      setAccounts((currentAccounts) => currentAccounts.filter((account) =>
        account.email.trim().toLowerCase() !== linkedAccount.email.trim().toLowerCase(),
      ))
    }
    if (selectedMember === memberName) setSelectedMember('all')
    return { success: true }
  }

  const clearSavingsTransactions = async (adminPassword: string, confirmationText: string) => {
    if (signedInRole !== 'admin') {
      return { success: false, message: 'Only an admin can clear savings transactions.' }
    }
    if (confirmationText !== 'delete ALL datas') {
      return { success: false, message: 'Type “delete ALL datas” exactly to continue.' }
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

    setLastTransactionUndo(null)
    const resetDate = getLocalDate()
    const deletedTransactions = members.flatMap((member): DeletedSavingsTransaction[] => [
      ...(member.initialSavings > 0 ? [{
        memberName: member.name,
        type: 'initial savings' as const,
        amount: member.initialSavings,
        date: member.initialSavingsDate,
        deletedAt: resetDate,
      }] : []),
      ...member.contributions.map((contribution) => ({
        memberName: member.name,
        type: 'contribution' as const,
        amount: contribution.amount,
        date: contribution.date,
        details: contribution.source,
        deletedAt: resetDate,
      })),
      ...member.withdrawals.map((withdrawal) => ({
        memberName: member.name,
        type: 'withdrawal' as const,
        amount: withdrawal.amount,
        date: withdrawal.date,
        details: withdrawal.reason,
        deletedAt: resetDate,
      })),
      ...(member.adjustments ?? []).map((adjustment) => ({
        memberName: member.name,
        type: 'adjustment' as const,
        amount: Number((adjustment.newAmount - adjustment.previousAmount).toFixed(2)),
        date: adjustment.date,
        details: adjustment.reason,
        previousAmount: adjustment.previousAmount,
        newAmount: adjustment.newAmount,
        deletedAt: resetDate,
      })),
    ])
    setDeletedSavingsTransactions((currentTransactions) => [
      ...currentTransactions,
      ...deletedTransactions,
    ])
    setMembers((currentMembers) => currentMembers.map((member) => ({
      ...member,
      initialSavings: 0,
      initialSavingsDate: resetDate,
      contributions: [],
      withdrawals: [],
      adjustments: [],
    })))
    return { success: true }
  }

  const clearLoanRecords = async (adminPassword: string, confirmationText: string) => {
    if (signedInRole !== 'admin') {
      return { success: false, message: 'Only an admin can clear loan records.' }
    }
    if (confirmationText !== 'delete ALL datas') {
      return { success: false, message: 'Type “delete ALL datas” exactly to continue.' }
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

    setLastTransactionUndo(null)
    const deletedAt = getLocalDate()
    const borrowerRecords = borrowers.flatMap((borrower): DeletedLoanRecord[] => {
      const borrowerTransactions = borrower.transactions ?? []
      const records = borrowerTransactions.map((transaction) => ({
        borrowerId: borrower.id,
        borrowerName: borrower.name,
        email: borrower.email,
        guarantorName: borrower.guarantorName,
        loanAmount: borrower.loanAmount,
        interestRate: borrower.interestRate,
        paydayInterest: borrower.paydayInterest,
        createdAt: borrower.createdAt,
        transaction,
        deletedAt,
      }))
      return records.length > 0 ? records : [{
        borrowerId: borrower.id,
        borrowerName: borrower.name,
        email: borrower.email,
        guarantorName: borrower.guarantorName,
        loanAmount: borrower.loanAmount,
        interestRate: borrower.interestRate,
        paydayInterest: borrower.paydayInterest,
        createdAt: borrower.createdAt,
        deletedAt,
      }]
    })
    const removedTransactionRecords = removedBorrowerTransactions.map(({ borrowerId, borrowerName, transaction }) => ({
      borrowerId,
      borrowerName,
      loanAmount: 0,
      interestRate: 0,
      paydayInterest: 0,
      createdAt: transaction.date,
      transaction,
      deletedAt,
    }))
    setDeletedLoans((currentLoans) => [...currentLoans, ...borrowerRecords, ...removedTransactionRecords])
    setBorrowers([])
    setRemovedBorrowerTransactions([])
    return { success: true }
  }

  const clearProfitTransactions = async (adminPassword: string, confirmationText: string) => {
    if (signedInRole !== 'admin') {
      return { success: false, message: 'Only an admin can clear profit transactions.' }
    }
    if (confirmationText !== 'delete ALL datas') {
      return { success: false, message: 'Type “delete ALL datas” exactly to continue.' }
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

    setLastTransactionUndo(null)
    const deletedAt = getLocalDate()
    setDeletedProfitTransactions((currentTransactions) => [
      ...currentTransactions,
      ...profitCashouts.map((transaction) => ({ ...transaction, deletedAt })),
    ])
    setProfitTransfers([])
    setOtherProfits([])
    setProfitCashouts([])
    return { success: true }
  }

  const addBorrower = (borrower: Borrower) => {
    if (signedInRole !== 'admin') return
    rememberTransactionUndo('new loan')
    setBorrowers((currentBorrowers) => [...currentBorrowers, borrower])
  }

  const removeBorrower = (borrowerId: string) => {
    if (signedInRole !== 'admin') return
    const borrowerToRemove = borrowers.find((borrower) => borrower.id === borrowerId)
    if (!borrowerToRemove
      || hasOutstandingBorrowerBalance(borrowerToRemove.loanAmount)
      || hasOutstandingBorrowerBalance(borrowerToRemove.paydayInterest)) return
    setLastTransactionUndo(null)
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

  const addBorrowerInterest = (borrowerId: string, date: string) => {
    if (signedInRole !== 'admin') return
    const borrower = borrowers.find((candidate) => candidate.id === borrowerId)
    if (!borrower || borrower.loanAmount <= 0) return
    rememberTransactionUndo('interest accrued')
    setBorrowers((currentBorrowers) => currentBorrowers.map((borrower) => {
      if (borrower.id !== borrowerId) return borrower
      const accruedInterest = Number((borrower.loanAmount * borrower.interestRate / 100).toFixed(2))
      const nextPaydayInterest = Number((borrower.paydayInterest + accruedInterest).toFixed(2))
      const nextTransaction = {
        id: crypto.randomUUID(),
        type: 'interest' as const,
        amount: accruedInterest,
        date,
      }
      return {
        ...borrower,
        paydayInterest: nextPaydayInterest,
        transactions: [...(borrower.transactions ?? []), nextTransaction],
      }
    }))
  }

  const payBorrowerInterest = (borrowerId: string, amount: number, date: string) => {
    if (signedInRole !== 'admin' || !Number.isFinite(amount) || amount <= 0) return
    const borrower = borrowers.find((candidate) => candidate.id === borrowerId)
    if (!borrower || amount > borrower.paydayInterest) return
    rememberTransactionUndo('interest payment')
    setBorrowers((currentBorrowers) => currentBorrowers.map((borrower) => {
      if (borrower.id !== borrowerId || amount > borrower.paydayInterest) return borrower
      const remainingInterest = Number((borrower.paydayInterest - amount).toFixed(2))
      const nextTransaction = {
        id: crypto.randomUUID(),
        type: 'interest-payment' as const,
        amount,
        date,
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
    const borrower = borrowers.find((candidate) => candidate.id === borrowerId)
    if (!borrower || hasOutstandingBorrowerBalance(borrower.paydayInterest) || amount > borrower.loanAmount) return
    rememberTransactionUndo('principal payment')
    setBorrowers((currentBorrowers) => currentBorrowers.map((borrower) => {
      if (borrower.id !== borrowerId
        || hasOutstandingBorrowerBalance(borrower.paydayInterest)
        || amount > borrower.loanAmount) return borrower
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

  const addBorrowerPrincipal = (borrowerId: string, amount: number, date: string) => {
    if (signedInRole !== 'admin' || !Number.isFinite(amount) || amount <= 0) return
    if (!borrowers.some((borrower) => borrower.id === borrowerId)) return
    rememberTransactionUndo('principal addition')
    setBorrowers((currentBorrowers) => currentBorrowers.map((borrower) => {
      if (borrower.id !== borrowerId) return borrower
      const updatedLoanAmount = Number((borrower.loanAmount + amount).toFixed(2))
      if (!Number.isFinite(updatedLoanAmount)) return borrower
      const nextTransaction = {
        id: crypto.randomUUID(),
        type: 'principal-addition' as const,
        amount,
        date,
      }
      return {
        ...borrower,
        loanAmount: updatedLoanAmount,
        transactions: [...(borrower.transactions ?? []), nextTransaction],
      }
    }))
  }

  const editBorrowerPrincipal = (borrowerId: string, amount: number, reason: string, date: string) => {
    if (signedInRole !== 'admin' || !Number.isFinite(amount) || amount < 0 || !reason.trim()) return
    const borrower = borrowers.find((candidate) => candidate.id === borrowerId)
    if (!borrower || Number(borrower.loanAmount.toFixed(2)) === Number(amount.toFixed(2))) return
    rememberTransactionUndo('principal adjustment')
    setBorrowers((currentBorrowers) => currentBorrowers.map((borrower) => {
      if (borrower.id !== borrowerId) return borrower
      const previousAmount = Number(borrower.loanAmount.toFixed(2))
      const newAmount = Number(amount.toFixed(2))
      if (previousAmount === newAmount) return borrower
      const nextTransaction = {
        id: crypto.randomUUID(),
        type: 'principal-adjustment' as const,
        amount: Number((newAmount - previousAmount).toFixed(2)),
        previousAmount,
        newAmount,
        reason: reason.trim(),
        date,
      }
      return {
        ...borrower,
        loanAmount: newAmount,
        transactions: [...(borrower.transactions ?? []), nextTransaction],
      }
    }))
  }

  const verifyAdminExportPassword = async (password: string) => {
    if (signedInRole !== 'admin') throw new Error('Only an admin can export data.')
    const adminAccount = accounts.find((account) =>
      account.role === 'admin'
      && account.email.trim().toLowerCase() === signedInEmail.trim().toLowerCase(),
    )
    if (!adminAccount) throw new Error('The logged-in admin account could not be verified.')
    if (!(await verifyPassword(password, adminAccount))) throw new Error('The admin password is incorrect.')
  }

  const exportOverviewData = () => downloadWorkbook('overview-data.xlsx', (workbook) => {
    const groupUpdateData = loadGroupUpdateData().data
    const summarySheet = workbook.addWorksheet('Summary')
    summarySheet.addRow(['Metric', 'Amount (PHP)'])
    summarySheet.addRows([
      ['Total savings', totalSavings],
      ['Total loan proceeds', totalLoanProceeds],
      ['Total interest paid', totalInterestPaid],
      ['Other profits', totalOtherProfit],
      ['Total net profit', totalInterestPaid + totalOtherProfit],
      ['Total receivable interest', totalReceivableInterest],
      ['Group allowance', totalGroupAllowance],
      ['Group operating cost', groupUpdateData.operationCosts.reduce((total, cost) => total + cost.amount, 0)],
    ])

    const monthlySheet = workbook.addWorksheet('Monthly Net Profit')
    monthlySheet.addRow(['Year', currentYear])
    monthlySheet.addRow(['Month', 'Amount (PHP)'])
    monthlyNetProfit.forEach(({ month, value }) => monthlySheet.addRow([month, value]))

    const cashInSheet = workbook.addWorksheet('Cash In')
    cashInSheet.addRow(['Name', 'Type', 'Amount (PHP)', 'Date', 'Reason', 'Previous Amount (PHP)', 'New Amount (PHP)'])
    cashInTransactions.forEach((transaction) => cashInSheet.addRow([
      transaction.name,
      transaction.type,
      transaction.amount,
      transaction.date,
      transaction.reason ?? '',
      transaction.previousAmount ?? '',
      transaction.newAmount ?? '',
    ]))

    const cashOutSheet = workbook.addWorksheet('Cash Out')
    cashOutSheet.addRow(['Name', 'Type', 'Amount (PHP)', 'Date', 'Reason', 'Previous Amount (PHP)', 'New Amount (PHP)'])
    cashOutTransactions.forEach((transaction) => cashOutSheet.addRow([
      transaction.name,
      transaction.type,
      transaction.amount,
      transaction.date,
      transaction.reason ?? '',
      transaction.previousAmount ?? '',
      transaction.newAmount ?? '',
    ]))
  })

  const exportSavingsData = () => downloadWorkbook('savings-data.xlsx', (workbook) => {
    const memberSheet = workbook.addWorksheet('Members')
    memberSheet.addRow(['Member', 'Email', 'Initial Savings (PHP)', 'Initial Savings Date', 'Current Savings (PHP)'])
    members.forEach((member) => memberSheet.addRow([
      member.name,
      member.accountEmail ?? '',
      member.initialSavings,
      member.initialSavingsDate,
      getMemberSavings(member),
    ]))

    const contributionsSheet = workbook.addWorksheet('Contributions')
    contributionsSheet.addRow(['Member', 'Date', 'Amount (PHP)', 'Source'])
    members.forEach((member) => member.contributions.forEach((contribution) => {
      contributionsSheet.addRow([member.name, contribution.date, contribution.amount, contribution.source ?? ''])
    }))

    const withdrawalsSheet = workbook.addWorksheet('Withdrawals')
    withdrawalsSheet.addRow(['Member', 'Date', 'Amount (PHP)', 'Reason'])
    members.forEach((member) => member.withdrawals.forEach((withdrawal) => {
      withdrawalsSheet.addRow([member.name, withdrawal.date, withdrawal.amount, withdrawal.reason])
    }))

    const adjustmentsSheet = workbook.addWorksheet('Adjustments')
    adjustmentsSheet.addRow(['Member', 'ID', 'Date', 'Previous Savings (PHP)', 'New Savings (PHP)', 'Reason'])
    members.forEach((member) => (member.adjustments ?? []).forEach((adjustment) => {
      adjustmentsSheet.addRow([
        member.name,
        adjustment.id,
        adjustment.date,
        adjustment.previousAmount,
        adjustment.newAmount,
        adjustment.reason,
      ])
    }))

    const deletedSheet = workbook.addWorksheet('Deleted Savings')
    deletedSheet.addRow(['Member', 'Type', 'Date', 'Amount (PHP)', 'Details', 'Deleted At'])
    deletedSavingsTransactions.forEach((transaction) => deletedSheet.addRow([
      transaction.memberName,
      transaction.type,
      transaction.date,
      transaction.amount,
      transaction.details ?? '',
      transaction.deletedAt,
    ]))
  })

  const exportLoansData = () => downloadWorkbook('loans-data.xlsx', (workbook) => {
    const borrowerSheet = workbook.addWorksheet('Borrowers')
    borrowerSheet.addRow(['Borrower ID', 'Name', 'Email', 'Guarantor', 'Created At', 'Principal (PHP)', 'Interest Rate (%)', 'Interest Due (PHP)'])
    borrowers.forEach((borrower) => borrowerSheet.addRow([
      borrower.id,
      borrower.name,
      borrower.email ?? '',
      borrower.guarantorName ?? '',
      borrower.createdAt,
      borrower.loanAmount,
      borrower.interestRate,
      borrower.paydayInterest,
    ]))

    const transactionSheet = workbook.addWorksheet('Loan Transactions')
    transactionSheet.addRow(['Borrower ID', 'Borrower', 'Status', 'Transaction ID', 'Type', 'Amount (PHP)', 'Date', 'Previous Principal (PHP)', 'New Principal (PHP)', 'Reason'])
    borrowers.forEach((borrower) => (borrower.transactions ?? []).forEach((transaction) => {
      transactionSheet.addRow([
        borrower.id,
        borrower.name,
        'Current',
        transaction.id,
        transaction.type,
        transaction.amount,
        transaction.date,
        transaction.previousAmount ?? '',
        transaction.newAmount ?? '',
        transaction.reason ?? '',
      ])
    }))
    removedBorrowerTransactions.forEach(({ borrowerId, borrowerName, transaction }) => {
      transactionSheet.addRow([
        borrowerId,
        borrowerName,
        'Removed borrower',
        transaction.id,
        transaction.type,
        transaction.amount,
        transaction.date,
        transaction.previousAmount ?? '',
        transaction.newAmount ?? '',
        transaction.reason ?? '',
      ])
    })

    const deletedSheet = workbook.addWorksheet('Deleted Loans')
    deletedSheet.addRow(['Borrower ID', 'Borrower', 'Email', 'Guarantor', 'Principal (PHP)', 'Interest Rate (%)', 'Interest Due (PHP)', 'Created At', 'Transaction Type', 'Transaction Amount (PHP)', 'Transaction Date', 'Deleted At'])
    deletedLoans.forEach((loan) => deletedSheet.addRow([
      loan.borrowerId,
      loan.borrowerName,
      loan.email ?? '',
      loan.guarantorName ?? '',
      loan.loanAmount,
      loan.interestRate,
      loan.paydayInterest,
      loan.createdAt,
      loan.transaction?.type ?? '',
      loan.transaction?.amount ?? '',
      loan.transaction?.date ?? '',
      loan.deletedAt,
    ]))
  })

  const exportProfitData = () => downloadWorkbook('profit-data.xlsx', (workbook) => {
    const transfersSheet = workbook.addWorksheet('Profit Transfers')
    transfersSheet.addRow(['Amount (PHP)', 'Transfer Date', 'Period From', 'Period To', 'Payment Allocations'])
    profitTransfers.forEach((transfer) => transfersSheet.addRow([
      transfer.amount,
      transfer.date,
      transfer.periodFrom ?? '',
      transfer.periodTo ?? '',
      JSON.stringify(transfer.paymentAllocations ?? []),
    ]))

    const otherProfitsSheet = workbook.addWorksheet('Other Profits')
    otherProfitsSheet.addRow(['ID', 'Amount (PHP)', 'Source', 'Date'])
    otherProfits.forEach((profit) => otherProfitsSheet.addRow([
      profit.id,
      profit.amount,
      profit.source,
      profit.date,
    ]))

    const payoutsSheet = workbook.addWorksheet('Profit Payouts')
    payoutsSheet.addRow(['Member', 'Amount (PHP)', 'Date', 'Action', 'Transfer Total (PHP)', 'Encoder'])
    profitCashouts.forEach((cashout) => payoutsSheet.addRow([
      cashout.memberName,
      cashout.amount,
      cashout.date,
      cashout.action ?? 'cashout',
      cashout.transferTotal ?? '',
      cashout.encoderName ?? '',
    ]))

    const deletedSheet = workbook.addWorksheet('Deleted Profit')
    deletedSheet.addRow(['Member', 'Amount (PHP)', 'Date', 'Action', 'Transfer Total (PHP)', 'Deleted At', 'Encoder'])
    deletedProfitTransactions.forEach((transaction) => deletedSheet.addRow([
      transaction.memberName,
      transaction.amount,
      transaction.date,
      transaction.action ?? 'cashout',
      transaction.transferTotal ?? '',
      transaction.deletedAt,
      transaction.encoderName ?? '',
    ]))
  })

  const renderPage = () => {
    if (signedInRole !== 'admin') {
      if (activeTab === 'overview') {
        return <OverviewPage
          totalSavings={totalSavings}
          totalLoanProceeds={totalLoanProceeds}
          totalInterestPaid={totalInterestPaid}
          totalOtherProfit={totalOtherProfit}
          monthlyNetProfit={monthlyNetProfit}
          cashInTransactions={cashInTransactions}
          cashOutTransactions={cashOutTransactions}
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
            onEditMemberSavings={editMemberSavings}
            onAddMember={addMemberAccount}
            onDeleteMember={deleteSavingsMember}
            onClearSavingsTransactions={clearSavingsTransactions}
          />
        )
      }
      if (activeTab === 'loans') {
        return (
          <LoansPage
            borrowers={borrowers}
            guarantors={registeredGuarantors}
            isAdmin={false}
            onAddBorrower={addBorrower}
            onAddBorrowerInterest={addBorrowerInterest}
            onPayBorrowerInterest={payBorrowerInterest}
            onPayBorrowerPrincipal={payBorrowerPrincipal}
            onAddBorrowerPrincipal={addBorrowerPrincipal}
            onEditBorrowerPrincipal={editBorrowerPrincipal}
            onRemoveBorrower={removeBorrower}
            onClearLoans={clearLoanRecords}
            totalInterestPaid={totalInterestPaid}
          />
        )
      }
      if (activeTab === 'profits') {
        const distributedProfitTotal = Number(
          profitTransfers.reduce((total, transfer) => total + transfer.amount, 0).toFixed(2),
        )
        return (
          <main className="page-view profits-page">
            <section className="page-header">
              <div>
                <p className="eyebrow">Profits</p>
                <h2>Performance summary</h2>
              </div>
            </section>
            <MemberProfitSummary
              memberProfits={getMemberProfitShares(members, profitCashouts, distributedProfitTotal)}
            />
          </main>
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
            onEditMemberSavings={editMemberSavings}
            onAddMember={addMemberAccount}
            onDeleteMember={deleteSavingsMember}
            onClearSavingsTransactions={clearSavingsTransactions}
          />
        )
      case 'loans':
        return (
          <LoansPage
            borrowers={borrowers}
            guarantors={registeredGuarantors}
            isAdmin={signedInRole === 'admin'}
            onAddBorrower={addBorrower}
            onAddBorrowerInterest={addBorrowerInterest}
            onPayBorrowerInterest={payBorrowerInterest}
            onPayBorrowerPrincipal={payBorrowerPrincipal}
            onAddBorrowerPrincipal={addBorrowerPrincipal}
            onEditBorrowerPrincipal={editBorrowerPrincipal}
            onRemoveBorrower={removeBorrower}
            onClearLoans={clearLoanRecords}
            totalInterestPaid={totalInterestPaid}
          />
        )
      case 'profits':
        return <ProfitsPage
          members={members}
          borrowers={borrowers}
          removedBorrowerTransactions={removedBorrowerTransactions}
          profitTransfers={profitTransfers}
          otherProfits={otherProfits}
          profitCashouts={profitCashouts}
          totalInterestPaid={totalInterestPaid}
          totalReceivableInterest={totalReceivableInterest}
          totalGroupAllowance={totalGroupAllowance}
          isAdmin={signedInRole === 'admin'}
          onAddOtherProfit={addOtherProfit}
          onApplyMemberProfitAction={applyMemberProfitAction}
          onSendToEncoder={sendProfitToEncoder}
          onTransferProfit={transferProfit}
          onClearProfitTransactions={clearProfitTransactions}
        />
      case 'data':
        return (
          <DataPage
            borrowers={borrowers}
            onExportOverview={async (password) => {
              await verifyAdminExportPassword(password)
              await exportOverviewData()
            }}
            onExportSavings={async (password) => {
              await verifyAdminExportPassword(password)
              await exportSavingsData()
            }}
            onExportLoans={async (password) => {
              await verifyAdminExportPassword(password)
              await exportLoansData()
            }}
            onExportProfits={async (password) => {
              await verifyAdminExportPassword(password)
              await exportProfitData()
            }}
          />
        )
      case 'group-update':
        return <GroupUpdatePage members={members} />
      case 'overview':
      default:
        return <OverviewPage
          totalSavings={totalSavings}
          totalLoanProceeds={totalLoanProceeds}
          totalInterestPaid={totalInterestPaid}
          totalOtherProfit={totalOtherProfit}
          monthlyNetProfit={monthlyNetProfit}
          cashInTransactions={cashInTransactions}
          cashOutTransactions={cashOutTransactions}
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
                {(signedInRole === 'admin'
                  ? tabs
                  : tabs.filter((tab) => ['overview', 'savings', 'loans', 'profits'].includes(tab.id))).map((tab) => (
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
              {signedInRole === 'admin' && (
                <button
                  type="button"
                  className="secondary-button undo-transaction-button"
                  disabled={!lastTransactionUndo}
                  title={lastTransactionUndo
                    ? `Undo ${lastTransactionUndo.label}`
                    : 'No recent transaction to undo'}
                  aria-label={lastTransactionUndo
                    ? `Undo last transaction: ${lastTransactionUndo.label}`
                    : 'No recent transaction to undo'}
                  onClick={() => {
                    if (!lastTransactionUndo) return
                    setUndoAdminPassword('')
                    setUndoPasswordError('')
                    setIsUndoPasswordOpen(true)
                  }}
                >
                  <span aria-hidden="true">↶</span>
                </button>
              )}
              <button
                type="button"
                className="login-button"
                onClick={() => {
                  if (!window.confirm('Are you sure you want to sign out?')) return
                  setSignedInUser('')
                  setSignedInEmail('')
                  setSignedInRole(null)
                  setLastTransactionUndo(null)
                  setIsUndoPasswordOpen(false)
                  setUndoAdminPassword('')
                  setUndoPasswordError('')
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
      {isUndoPasswordOpen && signedInRole === 'admin' && createPortal(
        <div className="login-overlay" data-theme={isDarkMode ? 'dark' : 'light'}>
          <section
            className="login-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="undo-password-title"
          >
            <div className="login-dialog-header">
              <div>
                <p className="eyebrow">Protected action</p>
                <h2 id="undo-password-title">Undo last transaction</h2>
              </div>
              <button
                type="button"
                className="login-close-button"
                aria-label="Cancel undo"
                disabled={isVerifyingUndoPassword}
                onClick={closeUndoPasswordDialog}
              >
                ×
              </button>
            </div>
            <form className="login-form" noValidate onSubmit={(event) => void handleUndoSubmit(event)}>
              <p className="login-note">
                Enter your admin password to undo {lastTransactionUndo?.label ?? 'the last transaction'}.
              </p>
              <label>
                Admin password
                <input
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  required
                  value={undoAdminPassword}
                  onChange={(event) => {
                    setUndoAdminPassword(event.target.value)
                    setUndoPasswordError('')
                  }}
                />
              </label>
              <button type="submit" className="primary-button" disabled={isVerifyingUndoPassword}>
                {isVerifyingUndoPassword ? 'Verifying…' : 'Confirm undo'}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={isVerifyingUndoPassword}
                onClick={closeUndoPasswordDialog}
              >
                Cancel
              </button>
              {undoPasswordError && <p className="member-error" role="alert">{undoPasswordError}</p>}
            </form>
          </section>
        </div>,
        document.body,
      )}
    </div>
  )
}

export default App
