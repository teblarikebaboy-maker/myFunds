import type ExcelJS from 'exceljs'

export type SavingsContribution = { amount: number; date: string; source?: 'member profit'; recordedBy?: string }
export type SavingsWithdrawal = { amount: number; date: string; reason: string; recordedBy?: string }
export type SavingsAdjustment = {
  id: string
  previousAmount: number
  newAmount: number
  date: string
  reason: string
}
export type DeletedSavingsTransaction = {
  memberName: string
  type: 'initial savings' | 'contribution' | 'withdrawal' | 'adjustment'
  amount: number
  date: string
  details?: string
  previousAmount?: number
  newAmount?: number
  deletedAt: string
}
export type Member = {
  name: string
  accountEmail?: string
  initialSavings: number
  initialSavingsDate: string
  contributions: SavingsContribution[]
  withdrawals: SavingsWithdrawal[]
  adjustments?: SavingsAdjustment[]
}
export type AccountRole = 'admin' | 'member'
export type DatabaseAccount = {
  email: string
  name: string
  role: AccountRole
  salt: string
  passwordHash: string
  createdAt: string
}
export type LoanTransaction = {
  id: string
  type: 'loan' | 'interest' | 'interest-payment' | 'principal-payment' | 'principal-addition' | 'principal-adjustment'
  amount: number
  date: string
  previousAmount?: number
  newAmount?: number
  reason?: string
}
export type RemovedBorrowerTransaction = {
  borrowerId: string
  borrowerName: string
  transaction: LoanTransaction
}
export type DeletedLoanRecord = {
  borrowerId: string
  borrowerName: string
  email?: string
  guarantorName?: string
  loanAmount: number
  interestRate: number
  paydayInterest: number
  createdAt: string
  transaction?: LoanTransaction
  deletedAt: string
}
export type ProfitTransfer = {
  amount: number
  date: string
  periodFrom?: string
  periodTo?: string
  paymentAllocations?: Array<{ transactionId: string; amount: number }>
}
export type OtherProfit = {
  id: string
  amount: number
  source: string
  date: string
}
export type ProfitCashout = {
  memberName: string
  amount: number
  date: string
  action?: 'cashout' | 'added to savings' | 'penalty' | 'encoder'
  transferTotal?: number
  encoderName?: string
}
export type DeletedProfitTransaction = ProfitCashout & { deletedAt: string }

export type Borrower = {
  id: string
  name: string
  email?: string
  guarantorName?: string
  loanAmount: number
  interestRate: number
  paydayInterest: number
  createdAt: string
  transactions: LoanTransaction[]
}

export type DirectoryPermission = 'granted' | 'denied' | 'prompt'
export type DatabaseFileHandle = {
  getFile: () => Promise<File>
  createWritable: () => Promise<{ write: (data: Blob | ArrayBuffer | ArrayBufferView) => Promise<void>; close: () => Promise<void> }>
}
export type DatabaseDirectoryHandle = {
  name: string
  queryPermission: (options: { mode: 'readwrite' }) => Promise<DirectoryPermission>
  requestPermission: (options: { mode: 'readwrite' }) => Promise<DirectoryPermission>
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<DatabaseFileHandle>
}

const LOCAL_STORAGE_KEY = 'funds-organizer-members-v1'
const LOCAL_PROFIT_CASHOUTS_KEY = 'funds-organizer-profit-cashouts-v1'
const LOCAL_OTHER_PROFITS_KEY = 'funds-organizer-other-profits-v1'
const LOCAL_DELETED_SAVINGS_TRANSACTIONS_KEY = 'funds-organizer-deleted-savings-transactions-v1'
const LOCAL_DELETED_PROFIT_TRANSACTIONS_KEY = 'funds-organizer-deleted-profit-transactions-v1'
const LOCAL_DELETED_LOANS_KEY = 'funds-organizer-deleted-loans-v1'
const DATABASE_FILE_NAME = 'funds-organizer-database.xlsx'
const DIRECTORY_DATABASE_NAME = 'funds-organizer-directory'
const DIRECTORY_STORE_NAME = 'settings'
const DIRECTORY_HANDLE_KEY = 'database-folder'

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<DatabaseDirectoryHandle>
}

export const supportsDatabaseFolder = () =>
  typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function'

export const loadSavedMembers = (): Member[] => {
  try {
    const savedMembers = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!savedMembers) return []
    const parsed: unknown = JSON.parse(savedMembers)
    return Array.isArray(parsed) ? parsed as Member[] : []
  } catch {
    return []
  }
}

export const saveMembersLocally = (members: Member[]) => {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(members))
  } catch {
    // Keep the application usable when browser storage is unavailable.
  }
}

export const loadSavedProfitCashouts = (): ProfitCashout[] => {
  try {
    const savedCashouts = localStorage.getItem(LOCAL_PROFIT_CASHOUTS_KEY)
    if (!savedCashouts) return []
    const parsed: unknown = JSON.parse(savedCashouts)
    return Array.isArray(parsed) ? parsed as ProfitCashout[] : []
  } catch {
    return []
  }
}

export const saveProfitCashoutsLocally = (cashouts: ProfitCashout[]) => {
  try {
    localStorage.setItem(LOCAL_PROFIT_CASHOUTS_KEY, JSON.stringify(cashouts))
  } catch {
    // Keep the application usable when browser storage is unavailable.
  }
}

export const loadSavedOtherProfits = (): OtherProfit[] => {
  try {
    const savedProfits = localStorage.getItem(LOCAL_OTHER_PROFITS_KEY)
    if (!savedProfits) return []
    const parsed: unknown = JSON.parse(savedProfits)
    return Array.isArray(parsed)
      ? parsed.filter((profit): profit is OtherProfit => Boolean(profit)
        && typeof profit.id === 'string'
        && typeof profit.amount === 'number'
        && Number.isFinite(profit.amount)
        && profit.amount > 0
        && typeof profit.source === 'string'
        && typeof profit.date === 'string')
      : []
  } catch {
    return []
  }
}

export const saveOtherProfitsLocally = (profits: OtherProfit[]) => {
  try {
    localStorage.setItem(LOCAL_OTHER_PROFITS_KEY, JSON.stringify(profits))
  } catch {
    // Keep the application usable when browser storage is unavailable.
  }
}

export const loadSavedDeletedSavingsTransactions = (): DeletedSavingsTransaction[] => {
  try {
    const savedTransactions = localStorage.getItem(LOCAL_DELETED_SAVINGS_TRANSACTIONS_KEY)
    if (!savedTransactions) return []
    const parsed: unknown = JSON.parse(savedTransactions)
    return Array.isArray(parsed) ? parsed as DeletedSavingsTransaction[] : []
  } catch {
    return []
  }
}

export const saveDeletedSavingsTransactionsLocally = (transactions: DeletedSavingsTransaction[]) => {
  try {
    localStorage.setItem(LOCAL_DELETED_SAVINGS_TRANSACTIONS_KEY, JSON.stringify(transactions))
  } catch {
    // Keep the application usable when browser storage is unavailable.
  }
}

export const loadSavedDeletedProfitTransactions = (): DeletedProfitTransaction[] => {
  try {
    const savedTransactions = localStorage.getItem(LOCAL_DELETED_PROFIT_TRANSACTIONS_KEY)
    if (!savedTransactions) return []
    const parsed: unknown = JSON.parse(savedTransactions)
    return Array.isArray(parsed) ? parsed as DeletedProfitTransaction[] : []
  } catch {
    return []
  }
}

export const saveDeletedProfitTransactionsLocally = (transactions: DeletedProfitTransaction[]) => {
  try {
    localStorage.setItem(LOCAL_DELETED_PROFIT_TRANSACTIONS_KEY, JSON.stringify(transactions))
  } catch {
    // Keep the application usable when browser storage is unavailable.
  }
}

export const loadSavedDeletedLoans = (): DeletedLoanRecord[] => {
  try {
    const savedLoans = localStorage.getItem(LOCAL_DELETED_LOANS_KEY)
    if (!savedLoans) return []
    const parsed: unknown = JSON.parse(savedLoans)
    return Array.isArray(parsed) ? parsed as DeletedLoanRecord[] : []
  } catch {
    return []
  }
}

export const saveDeletedLoansLocally = (loans: DeletedLoanRecord[]) => {
  try {
    localStorage.setItem(LOCAL_DELETED_LOANS_KEY, JSON.stringify(loans))
  } catch {
    // Keep the application usable when browser storage is unavailable.
  }
}

const openDirectoryDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DIRECTORY_DATABASE_NAME, 1)
  request.onupgradeneeded = () => {
    request.result.createObjectStore(DIRECTORY_STORE_NAME)
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('Could not open saved folder settings.'))
})

export const loadSavedDirectory = async (): Promise<DatabaseDirectoryHandle | null> => {
  const database = await openDirectoryDatabase()
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(DIRECTORY_STORE_NAME, 'readonly')
      .objectStore(DIRECTORY_STORE_NAME)
      .get(DIRECTORY_HANDLE_KEY)
    request.onsuccess = () => resolve((request.result as DatabaseDirectoryHandle | undefined) ?? null)
    request.onerror = () => reject(request.error ?? new Error('Could not read saved folder settings.'))
  })
}

export const saveDirectory = async (directory: DatabaseDirectoryHandle) => {
  const database = await openDirectoryDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DIRECTORY_STORE_NAME, 'readwrite')
    transaction.objectStore(DIRECTORY_STORE_NAME).put(directory, DIRECTORY_HANDLE_KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the database folder.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Could not save the database folder.'))
  })
}

export const chooseDatabaseDirectory = async () => {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker
  if (!picker) throw new Error('Folder selection is supported in current versions of Chrome and Edge.')
  return picker({ mode: 'readwrite' })
}

const getCellDate = (value: ExcelJS.CellValue): string => {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value ?? '').trim()
}

const getCellNumber = (value: ExcelJS.CellValue, context: string): number => {
  const amount = Number(value)
  if (!Number.isFinite(amount)) throw new Error(`Invalid amount in the Excel database (${context}).`)
  return amount
}

const getPrincipalAdjustmentDetails = (row: ExcelJS.Row, headers: Map<string, number>) => {
  const emptyColumn = row.cellCount + 1
  const previousAmount = Number(row.getCell(headers.get('Previous Principal (PHP)') ?? emptyColumn).value)
  const newAmount = Number(row.getCell(headers.get('New Principal (PHP)') ?? emptyColumn).value)
  const reason = String(row.getCell(headers.get('Reason') ?? emptyColumn).value ?? '').trim()
  return Number.isFinite(previousAmount) && previousAmount >= 0
    && Number.isFinite(newAmount) && newAmount >= 0
    && reason
    ? { previousAmount, newAmount, reason }
    : undefined
}

const parseLoanTransactions = (value: string): LoanTransaction[] => {
  if (!value) return []
  try {
    const parsedTransactions: unknown = JSON.parse(value)
    if (!Array.isArray(parsedTransactions)) return []
    return parsedTransactions.filter((transaction): transaction is LoanTransaction => Boolean(transaction)
      && typeof transaction.id === 'string'
      && (transaction.type === 'loan'
        || transaction.type === 'interest'
        || transaction.type === 'interest-payment'
        || transaction.type === 'principal-payment'
        || transaction.type === 'principal-addition'
        || (transaction.type === 'principal-adjustment'
          && Number.isFinite(Number(transaction.previousAmount))
          && Number.isFinite(Number(transaction.newAmount))
          && typeof transaction.reason === 'string'))
      && Number.isFinite(Number(transaction.amount))
      && typeof transaction.date === 'string')
      .map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        amount: Number(transaction.amount),
        date: transaction.date,
        ...(transaction.type === 'principal-adjustment' ? {
          previousAmount: Number(transaction.previousAmount),
          newAmount: Number(transaction.newAmount),
          reason: transaction.reason,
        } : {}),
      }))
  } catch {
    return []
  }
}

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

const hexToBytes = (hex: string): Uint8Array<ArrayBuffer> => {
  if (!/^(?:[\da-f]{2})+$/i.test(hex)) throw new Error('Invalid account password data in the Excel database.')
  return new Uint8Array((hex.match(/.{2}/g) ?? []).map((byte) => Number.parseInt(byte, 16)))
}

const derivePasswordHash = async (password: string, salt: Uint8Array<ArrayBuffer>) => {
  const passwordKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
    passwordKey,
    256,
  )
  return bytesToHex(new Uint8Array(hash))
}

export const createPasswordHash = async (password: string) => {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return {
    salt: bytesToHex(salt),
    passwordHash: await derivePasswordHash(password, salt),
  }
}

export const verifyPassword = async (password: string, account: DatabaseAccount) => {
  const actualHash = hexToBytes(await derivePasswordHash(password, hexToBytes(account.salt)))
  const expectedHash = hexToBytes(account.passwordHash)
  if (actualHash.length !== expectedHash.length) return false
  return actualHash.reduce((difference, byte, index) => difference | (byte ^ expectedHash[index]), 0) === 0
}

export const readWorkbookData = async (
  directory: DatabaseDirectoryHandle,
): Promise<{ members: Member[]; accounts: DatabaseAccount[]; borrowers: Borrower[]; removedBorrowerTransactions: RemovedBorrowerTransaction[]; profitTransfers: ProfitTransfer[]; otherProfits?: OtherProfit[]; profitCashouts: ProfitCashout[]; deletedSavingsTransactions: DeletedSavingsTransaction[]; deletedProfitTransactions: DeletedProfitTransaction[]; deletedLoans: DeletedLoanRecord[] } | null> => {
  const ExcelJS = (await import('exceljs')).default
  let fileHandle: DatabaseFileHandle
  try {
    fileHandle = await directory.getFileHandle(DATABASE_FILE_NAME)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await (await fileHandle.getFile()).arrayBuffer())
  const membersSheet = workbook.getWorksheet('Members')
  if (!membersSheet) throw new Error('The selected folder contains an Excel file without a Members sheet.')

  const members = new Map<string, Member>()
  membersSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const name = String(row.getCell(1).value ?? '').trim()
    if (!name) return
    members.set(name, {
      name,
      initialSavings: getCellNumber(row.getCell(2).value, `${name}, initial savings`),
      initialSavingsDate: getCellDate(row.getCell(3).value),
      contributions: [],
      withdrawals: [],
      adjustments: [],
      accountEmail: String(row.getCell(4).value ?? '').trim().toLowerCase() || undefined,
    })
  })

  const contributionsSheet = workbook.getWorksheet('Contributions')
  contributionsSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const name = String(row.getCell(1).value ?? '').trim()
    if (!name) return
    const member = members.get(name)
    if (!member) throw new Error(`Excel contribution refers to unknown member "${name}".`)
    member.contributions.push({
      date: getCellDate(row.getCell(2).value),
      amount: getCellNumber(row.getCell(3).value, `${name}, contribution`),
      source: String(row.getCell(4).value ?? '').trim().toLowerCase() === 'member profit'
        ? 'member profit'
        : undefined,
      recordedBy: String(row.getCell(5).value ?? '').trim() || undefined,
    })
  })

  const withdrawalsSheet = workbook.getWorksheet('Withdrawals')
  withdrawalsSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const name = String(row.getCell(1).value ?? '').trim()
    if (!name) return
    const member = members.get(name)
    if (!member) throw new Error(`Excel withdrawal refers to unknown member "${name}".`)
    member.withdrawals.push({
      date: getCellDate(row.getCell(2).value),
      amount: getCellNumber(row.getCell(3).value, `${name}, withdrawal`),
      reason: String(row.getCell(4).value ?? ''),
      recordedBy: String(row.getCell(5).value ?? '').trim() || undefined,
    })
  })

  workbook.getWorksheet('Savings Adjustments')?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const name = String(row.getCell(1).value ?? '').trim()
    if (!name) return
    const member = members.get(name)
    if (!member) throw new Error(`Excel savings adjustment refers to unknown member "${name}".`)
    const id = String(row.getCell(2).value ?? '').trim()
    const date = getCellDate(row.getCell(3).value)
    const previousAmount = Number(row.getCell(4).value)
    const newAmount = Number(row.getCell(5).value)
    const reason = String(row.getCell(6).value ?? '').trim()
    if (!id || !date || !Number.isFinite(previousAmount) || previousAmount < 0
      || !Number.isFinite(newAmount) || newAmount < 0 || !reason) {
      throw new Error(`Excel savings adjustment for "${name}" has invalid details.`)
    }
    member.adjustments ??= []
    member.adjustments.push({ id, date, previousAmount, newAmount, reason })
  })

  const accounts: DatabaseAccount[] = []
  workbook.getWorksheet('Accounts')?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const email = String(row.getCell(1).value ?? '').trim().toLowerCase()
    const name = String(row.getCell(2).value ?? '').trim()
    const salt = String(row.getCell(3).value ?? '').trim()
    const passwordHash = String(row.getCell(4).value ?? '').trim()
    const createdAt = getCellDate(row.getCell(5).value)
    const roleValue = String(row.getCell(6).value ?? '').trim().toLowerCase()
    const role: AccountRole = roleValue === 'admin' ? 'admin' : 'member'
    if (email && name && salt && passwordHash) {
      accounts.push({ email, name, role, salt, passwordHash, createdAt })
    }
  })

  const borrowers: Borrower[] = []
  const borrowersSheet = workbook.getWorksheet('Borrowers')
  const borrowerHeaders = new Map<string, number>()
  borrowersSheet?.getRow(1).eachCell((cell, columnNumber) => {
    borrowerHeaders.set(String(cell.value ?? '').trim(), columnNumber)
  })
  const getBorrowerCell = (row: ExcelJS.Row, header: string, fallbackColumn: number) =>
    row.getCell(borrowerHeaders.get(header) ?? fallbackColumn).value
  const legacyTransactionsColumn = borrowerHeaders.get('Loan Transactions (JSON)')
  borrowersSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const id = String(getBorrowerCell(row, 'ID', 1) ?? '').trim()
    const name = String(getBorrowerCell(row, 'Name', 2) ?? '').trim()
    if (!id || !name) return
    const loanAmount = Number(getBorrowerCell(row, 'Loan Amount (PHP)', 6)) || 0
    const interestRateValue = getBorrowerCell(row, 'Interest Rate (%)', 9)
    const savedInterestRate = Number(interestRateValue)
    const interestRate = interestRateValue === null
      || interestRateValue === undefined
      || interestRateValue === ''
      || !Number.isFinite(savedInterestRate)
      || savedInterestRate < 0
      || savedInterestRate > 100
      ? 3
      : savedInterestRate
    const paydayInterestValue = getBorrowerCell(row, 'Total Interest (PHP)', borrowerHeaders.get('Payday Interest (PHP)') ?? 4)
    const savedPaydayInterest = Number(paydayInterestValue)
    const paydayInterest = paydayInterestValue === null
      || paydayInterestValue === undefined
      || paydayInterestValue === ''
      || !Number.isFinite(savedPaydayInterest)
      || savedPaydayInterest < 0
      ? loanAmount * 0.03
      : savedPaydayInterest
    const transactions = legacyTransactionsColumn
      ? parseLoanTransactions(String(row.getCell(legacyTransactionsColumn).value ?? '').trim())
      : []
    borrowers.push({
      id,
      name,
      email: String(getBorrowerCell(row, 'Email', 3) ?? '').trim(),
      guarantorName: String(getBorrowerCell(row, 'Guarantor', legacyTransactionsColumn ? 8 : 7) ?? '').trim(),
      loanAmount,
      interestRate,
      paydayInterest,
      createdAt: getCellDate(getBorrowerCell(row, 'Created At', 5)),
      transactions,
    })
  })

  const borrowersById = new Map(borrowers.map((borrower) => [borrower.id, borrower]))
  const borrowerTransactionsSheet = workbook.getWorksheet('Borrower Transactions')
  const borrowerTransactionHeaders = new Map<string, number>()
  borrowerTransactionsSheet?.getRow(1).eachCell((cell, columnNumber) => {
    borrowerTransactionHeaders.set(String(cell.value ?? '').trim(), columnNumber)
  })
  borrowerTransactionsSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const getCell = (header: string, fallbackColumn: number) =>
      row.getCell(borrowerTransactionHeaders.get(header) ?? fallbackColumn).value
    const borrower = borrowersById.get(String(getCell('Borrower ID', 1) ?? '').trim())
    const id = String(getCell('Transaction ID', 3) ?? '').trim()
    const type = String(getCell('Type', 4) ?? '').trim()
    const amount = Number(getCell('Amount (PHP)', 5))
    const date = getCellDate(getCell('Date', 6))
    const adjustmentDetails = type === 'principal-adjustment'
      ? getPrincipalAdjustmentDetails(row, borrowerTransactionHeaders)
      : undefined
    if (!borrower || !id
      || !['loan', 'interest', 'interest-payment', 'principal-payment', 'principal-addition', 'principal-adjustment'].includes(type)
      || !Number.isFinite(amount) || !date
      || (type === 'principal-adjustment' && !adjustmentDetails)) return
    borrower.transactions.push({
      id,
      type: type as LoanTransaction['type'],
      amount,
      date,
      ...adjustmentDetails,
    })
  })

  const removedBorrowerTransactions: RemovedBorrowerTransaction[] = []
  const removedBorrowerTransactionsSheet = workbook.getWorksheet('Removed Borrower Transactions')
  const removedTransactionHeaders = new Map<string, number>()
  removedBorrowerTransactionsSheet?.getRow(1).eachCell((cell, columnNumber) => {
    removedTransactionHeaders.set(String(cell.value ?? '').trim(), columnNumber)
  })
  removedBorrowerTransactionsSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const getCell = (header: string, fallbackColumn: number) =>
      row.getCell(removedTransactionHeaders.get(header) ?? fallbackColumn).value
    const borrowerId = String(getCell('Borrower ID', 1) ?? '').trim()
    const borrowerName = String(getCell('Borrower', 2) ?? '').trim()
    const id = String(getCell('Transaction ID', 3) ?? '').trim()
    const type = String(getCell('Type', 4) ?? '').trim()
    const amount = Number(getCell('Amount (PHP)', 5))
    const date = getCellDate(getCell('Date', 6))
    const adjustmentDetails = type === 'principal-adjustment'
      ? getPrincipalAdjustmentDetails(row, removedTransactionHeaders)
      : undefined
    if (!borrowerId || !borrowerName || !id
      || !['loan', 'interest', 'interest-payment', 'principal-payment', 'principal-addition', 'principal-adjustment'].includes(type)
      || !Number.isFinite(amount) || !date
      || (type === 'principal-adjustment' && !adjustmentDetails)) return
    removedBorrowerTransactions.push({
      borrowerId,
      borrowerName,
      transaction: {
        id,
        type: type as LoanTransaction['type'],
        amount,
        date,
        ...adjustmentDetails,
      },
    })
  })

  const profitTransfers: ProfitTransfer[] = []
  const profitTransfersSheet = workbook.getWorksheet('Profit Transfers')
  const transferHeaders = new Map<string, number>()
  profitTransfersSheet?.getRow(1).eachCell((cell, columnNumber) => {
    transferHeaders.set(String(cell.value ?? '').trim(), columnNumber)
  })
  const getTransferCell = (row: ExcelJS.Row, header: string, fallbackColumn: number) =>
    row.getCell(transferHeaders.get(header) ?? fallbackColumn).value
  profitTransfersSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const amount = Number(getTransferCell(row, 'Amount (PHP)', 1))
    const date = getCellDate(getTransferCell(row, 'Date', 2))
    const periodFrom = String(getTransferCell(row, 'Period From', 3) ?? '') || undefined
    const periodTo = String(getTransferCell(row, 'Period To', 4) ?? '') || undefined
    const allocationsValue = String(getTransferCell(row, 'Payment Allocations (JSON)', 5) ?? '')
    let paymentAllocations: ProfitTransfer['paymentAllocations']
    try {
      const parsed: unknown = JSON.parse(allocationsValue)
      if (Array.isArray(parsed)) {
        paymentAllocations = parsed.filter((allocation): allocation is { transactionId: string; amount: number } =>
          Boolean(allocation)
          && typeof allocation.transactionId === 'string'
          && Number.isFinite(Number(allocation.amount))
          && Number(allocation.amount) > 0,
        ).map((allocation) => ({ transactionId: allocation.transactionId, amount: Number(allocation.amount) }))
      }
    } catch {
      paymentAllocations = undefined
    }
    if (Number.isFinite(amount) && amount > 0 && date) {
      profitTransfers.push({ amount, date, periodFrom, periodTo, paymentAllocations })
    }
  })

  const otherProfits: OtherProfit[] = []
  const otherProfitsSheet = workbook.getWorksheet('Other Profits')
  const otherProfitHeaders = new Map<string, number>()
  otherProfitsSheet?.getRow(1).eachCell((cell, columnNumber) => {
    otherProfitHeaders.set(String(cell.value ?? '').trim(), columnNumber)
  })
  otherProfitsSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const getCell = (header: string, fallbackColumn: number) =>
      row.getCell(otherProfitHeaders.get(header) ?? fallbackColumn).value
    const id = String(getCell('ID', 1) ?? '').trim()
    const amount = Number(getCell('Amount (PHP)', 2))
    const source = String(getCell('Source', 3) ?? '').trim()
    const date = getCellDate(getCell('Date', 4))
    if (id && Number.isFinite(amount) && amount > 0 && source && date) {
      otherProfits.push({ id, amount, source, date })
    }
  })

  const profitCashouts: ProfitCashout[] = []
  workbook.getWorksheet('Profit Cashouts')?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const memberName = String(row.getCell(1).value ?? '').trim()
    const amount = getCellNumber(row.getCell(2).value, `${memberName || 'Unknown member'}, profit cashout`)
    const date = getCellDate(row.getCell(3).value)
    const actionValue = String(row.getCell(4).value ?? '').trim().toLowerCase()
    const action = actionValue === 'added to savings' || actionValue === 'penalty' || actionValue === 'encoder'
      ? actionValue
      : 'cashout'
    const transferTotalCell = row.getCell(5).value
    const transferTotalValue = transferTotalCell === null || transferTotalCell === undefined || transferTotalCell === ''
      ? Number.NaN
      : Number(transferTotalCell)
    const transferTotal = Number.isFinite(transferTotalValue) && transferTotalValue >= 0
      ? transferTotalValue
      : undefined
    const encoderName = String(row.getCell(6).value ?? '').trim() || undefined
    if (memberName && Number.isFinite(amount) && amount > 0 && date) {
      profitCashouts.push({ memberName, amount, date, action, transferTotal, encoderName })
    }
  })

  const deletedSavingsTransactions: DeletedSavingsTransaction[] = []
  workbook.getWorksheet('Deleted Savings Transactions')?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const memberName = String(row.getCell(1).value ?? '').trim()
    const type = String(row.getCell(2).value ?? '').trim().toLowerCase()
    const date = getCellDate(row.getCell(3).value)
    const amount = Number(row.getCell(4).value)
    const details = String(row.getCell(5).value ?? '').trim() || undefined
    const deletedAt = getCellDate(row.getCell(6).value)
    const previousAmount = Number(row.getCell(7).value)
    const newAmount = Number(row.getCell(8).value)
    if (memberName && ['initial savings', 'contribution', 'withdrawal', 'adjustment'].includes(type)
      && Number.isFinite(amount) && date && deletedAt
      && (type !== 'adjustment'
        || (Number.isFinite(previousAmount) && Number.isFinite(newAmount) && Boolean(details)))) {
      deletedSavingsTransactions.push({
        memberName,
        type: type as DeletedSavingsTransaction['type'],
        amount,
        date,
        details,
        ...(type === 'adjustment' ? { previousAmount, newAmount } : {}),
        deletedAt,
      })
    }
  })

  const deletedProfitTransactions: DeletedProfitTransaction[] = []
  workbook.getWorksheet('Deleted Profit Transactions')?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const memberName = String(row.getCell(1).value ?? '').trim()
    const amount = Number(row.getCell(2).value)
    const date = getCellDate(row.getCell(3).value)
    const actionValue = String(row.getCell(4).value ?? '').trim().toLowerCase()
    const action = actionValue === 'added to savings' || actionValue === 'penalty' || actionValue === 'encoder'
      ? actionValue
      : 'cashout'
    const transferTotalValue = Number(row.getCell(5).value)
    const transferTotal = Number.isFinite(transferTotalValue) && transferTotalValue >= 0 ? transferTotalValue : undefined
    const deletedAt = getCellDate(row.getCell(6).value)
    const encoderName = String(row.getCell(7).value ?? '').trim() || undefined
    if (memberName && Number.isFinite(amount) && amount > 0 && date && deletedAt) {
      deletedProfitTransactions.push({ memberName, amount, date, action, transferTotal, encoderName, deletedAt })
    }
  })

  const deletedLoans: DeletedLoanRecord[] = []
  workbook.getWorksheet('Deleted Loans')?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const borrowerId = String(row.getCell(1).value ?? '').trim()
    const borrowerName = String(row.getCell(2).value ?? '').trim()
    const email = String(row.getCell(3).value ?? '').trim() || undefined
    const guarantorName = String(row.getCell(4).value ?? '').trim() || undefined
    const loanAmount = Number(row.getCell(5).value) || 0
    const interestRate = Number(row.getCell(6).value) || 0
    const paydayInterest = Number(row.getCell(7).value) || 0
    const createdAt = getCellDate(row.getCell(8).value)
    const transactionId = String(row.getCell(9).value ?? '').trim()
    const transactionType = String(row.getCell(10).value ?? '').trim()
    const transactionAmount = Number(row.getCell(11).value)
    const transactionDate = getCellDate(row.getCell(12).value)
    const deletedAt = getCellDate(row.getCell(13).value)
    const adjustmentDetails = String(row.getCell(10).value ?? '').trim() === 'principal-adjustment'
      ? getPrincipalAdjustmentDetails(row, new Map([
        ['Previous Principal (PHP)', 14],
        ['New Principal (PHP)', 15],
        ['Reason', 16],
      ]))
      : undefined
    const validTransactionTypes: LoanTransaction['type'][] = ['loan', 'interest', 'interest-payment', 'principal-payment', 'principal-addition', 'principal-adjustment']
    if (!borrowerId || !borrowerName || !deletedAt) return
    const transaction = transactionId && validTransactionTypes.includes(transactionType as LoanTransaction['type'])
      && Number.isFinite(transactionAmount) && transactionDate
      && (transactionType !== 'principal-adjustment' || adjustmentDetails)
      ? { id: transactionId, type: transactionType as LoanTransaction['type'], amount: transactionAmount, date: transactionDate, ...adjustmentDetails }
      : undefined
    deletedLoans.push({
      borrowerId,
      borrowerName,
      email,
      guarantorName,
      loanAmount,
      interestRate,
      paydayInterest,
      createdAt,
      transaction,
      deletedAt,
    })
  })

  return { members: [...members.values()], accounts, borrowers, removedBorrowerTransactions, profitTransfers, otherProfits: otherProfitsSheet ? otherProfits : undefined, profitCashouts, deletedSavingsTransactions, deletedProfitTransactions, deletedLoans }
}

export const writeWorkbookData = async (
  directory: DatabaseDirectoryHandle,
  members: Member[],
  accounts: DatabaseAccount[],
  borrowers: Borrower[] = [],
  removedBorrowerTransactions: RemovedBorrowerTransaction[] = [],
  profitTransfers: ProfitTransfer[] = [],
  profitCashouts: ProfitCashout[] = [],
  deletedSavingsTransactions: DeletedSavingsTransaction[] = [],
  deletedProfitTransactions: DeletedProfitTransaction[] = [],
  deletedLoans: DeletedLoanRecord[] = [],
  otherProfits: OtherProfit[] = [],
) => {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Funds Organizer'

  const membersSheet = workbook.addWorksheet('Members')
  membersSheet.addRow(['Name', 'Initial Savings', 'Initial Savings Date', 'Account Email'])
  members.forEach((member) => membersSheet.addRow([
    member.name,
    member.initialSavings,
    member.initialSavingsDate,
    member.accountEmail ?? '',
  ]))

  const contributionsSheet = workbook.addWorksheet('Contributions')
  contributionsSheet.addRow(['Member', 'Date', 'Amount', 'Source', 'Recorded By'])
  members.forEach((member) => member.contributions.forEach((contribution) => {
    contributionsSheet.addRow([member.name, contribution.date, contribution.amount, contribution.source ?? '', contribution.recordedBy ?? ''])
  }))

  const withdrawalsSheet = workbook.addWorksheet('Withdrawals')
  withdrawalsSheet.addRow(['Member', 'Date', 'Amount', 'Reason', 'Recorded By'])
  members.forEach((member) => member.withdrawals.forEach((withdrawal) => {
    withdrawalsSheet.addRow([member.name, withdrawal.date, withdrawal.amount, withdrawal.reason, withdrawal.recordedBy ?? ''])
  }))

  const savingsAdjustmentsSheet = workbook.addWorksheet('Savings Adjustments')
  savingsAdjustmentsSheet.addRow(['Member', 'Transaction ID', 'Date', 'Previous Savings (PHP)', 'New Savings (PHP)', 'Reason'])
  members.forEach((member) => (member.adjustments ?? []).forEach((adjustment) => {
    savingsAdjustmentsSheet.addRow([
      member.name,
      adjustment.id,
      adjustment.date,
      adjustment.previousAmount,
      adjustment.newAmount,
      adjustment.reason,
    ])
  }))

  const accountsSheet = workbook.addWorksheet('Accounts')
  accountsSheet.addRow(['Email', 'Name', 'Salt', 'Password Hash', 'Created At', 'Role'])
  accounts.forEach((account) => accountsSheet.addRow([
    account.email,
    account.name,
    account.salt,
    account.passwordHash,
    account.createdAt,
    account.role,
  ]))

  const borrowersSheet = workbook.addWorksheet('Borrowers')
  borrowersSheet.addTable({
    name: 'BorrowersTable',
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: [
      { name: 'ID' },
      { name: 'Name' },
      { name: 'Email' },
      { name: 'Created At' },
      { name: 'Loan Amount (PHP)' },
      { name: 'Total Interest (PHP)' },
      { name: 'Guarantor' },
      { name: 'Interest Rate (%)' },
    ],
    rows: borrowers.map((borrower) => [
      borrower.id,
      borrower.name,
      borrower.email ?? '',
      borrower.createdAt,
      borrower.loanAmount,
      borrower.paydayInterest,
      borrower.guarantorName ?? '',
      borrower.interestRate,
    ]),
  })

  const borrowerTransactionsSheet = workbook.addWorksheet('Borrower Transactions')
  borrowerTransactionsSheet.addTable({
    name: 'BorrowerTransactionsTable',
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium4', showRowStripes: true },
    columns: [
      { name: 'Borrower ID' },
      { name: 'Borrower' },
      { name: 'Transaction ID' },
      { name: 'Type' },
      { name: 'Amount (PHP)' },
      { name: 'Date' },
      { name: 'Previous Principal (PHP)' },
      { name: 'New Principal (PHP)' },
      { name: 'Reason' },
    ],
    rows: borrowers.flatMap((borrower) => (borrower.transactions ?? []).map((transaction) => [
      borrower.id,
      borrower.name,
      transaction.id,
      transaction.type,
      transaction.amount,
      transaction.date,
      transaction.previousAmount ?? '',
      transaction.newAmount ?? '',
      transaction.reason ?? '',
    ])),
  })

  const removedBorrowerTransactionsSheet = workbook.addWorksheet('Removed Borrower Transactions')
  removedBorrowerTransactionsSheet.addTable({
    name: 'RemovedBorrowerTransactionsTable',
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium5', showRowStripes: true },
    columns: [
      { name: 'Borrower ID' },
      { name: 'Borrower' },
      { name: 'Transaction ID' },
      { name: 'Type' },
      { name: 'Amount (PHP)' },
      { name: 'Date' },
      { name: 'Previous Principal (PHP)' },
      { name: 'New Principal (PHP)' },
      { name: 'Reason' },
    ],
    rows: removedBorrowerTransactions.map(({ borrowerId, borrowerName, transaction }) => [
      borrowerId,
      borrowerName,
      transaction.id,
      transaction.type,
      transaction.amount,
      transaction.date,
      transaction.previousAmount ?? '',
      transaction.newAmount ?? '',
      transaction.reason ?? '',
    ]),
  })

  const profitTransfersSheet = workbook.addWorksheet('Profit Transfers')
  profitTransfersSheet.addRow(['Amount (PHP)', 'Date', 'Period From', 'Period To', 'Payment Allocations (JSON)'])
  profitTransfers.forEach((transfer) => profitTransfersSheet.addRow([
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

  const profitCashoutsSheet = workbook.addWorksheet('Profit Cashouts')
  profitCashoutsSheet.addRow(['Member', 'Amount (PHP)', 'Date', 'Action', 'Transfer Total (PHP)', 'Encoder'])
  profitCashouts.forEach((cashout) => profitCashoutsSheet.addRow([
    cashout.memberName,
    cashout.amount,
    cashout.date,
    cashout.action ?? 'cashout',
    cashout.transferTotal ?? '',
    cashout.encoderName ?? '',
  ]))

  const deletedSavingsSheet = workbook.addWorksheet('Deleted Savings Transactions')
  deletedSavingsSheet.addTable({
    name: 'DeletedSavingsTransactionsTable',
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium6', showRowStripes: true },
    columns: [
      { name: 'Member' },
      { name: 'Transaction Type' },
      { name: 'Transaction Date' },
      { name: 'Amount (PHP)' },
      { name: 'Details' },
      { name: 'Deleted At' },
      { name: 'Previous Savings (PHP)' },
      { name: 'New Savings (PHP)' },
    ],
    rows: deletedSavingsTransactions.map((transaction) => [
      transaction.memberName,
      transaction.type,
      transaction.date,
      transaction.amount,
      transaction.details ?? '',
      transaction.deletedAt,
      transaction.previousAmount ?? '',
      transaction.newAmount ?? '',
    ]),
  })

  const deletedProfitSheet = workbook.addWorksheet('Deleted Profit Transactions')
  deletedProfitSheet.addTable({
    name: 'DeletedProfitTransactionsTable',
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium7', showRowStripes: true },
    columns: [
      { name: 'Member' },
      { name: 'Amount (PHP)' },
      { name: 'Transaction Date' },
      { name: 'Action' },
      { name: 'Transfer Total (PHP)' },
      { name: 'Deleted At' },
      { name: 'Encoder' },
    ],
    rows: deletedProfitTransactions.map((transaction) => [
      transaction.memberName,
      transaction.amount,
      transaction.date,
      transaction.action ?? 'cashout',
      transaction.transferTotal ?? '',
      transaction.deletedAt,
      transaction.encoderName ?? '',
    ]),
  })

  const deletedLoansSheet = workbook.addWorksheet('Deleted Loans')
  deletedLoansSheet.addTable({
    name: 'DeletedLoansTable',
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium3', showRowStripes: true },
    columns: [
      { name: 'Borrower ID' },
      { name: 'Borrower' },
      { name: 'Email' },
      { name: 'Guarantor' },
      { name: 'Loan Amount (PHP)' },
      { name: 'Interest Rate (%)' },
      { name: 'Payday Interest (PHP)' },
      { name: 'Created At' },
      { name: 'Transaction ID' },
      { name: 'Transaction Type' },
      { name: 'Transaction Amount (PHP)' },
      { name: 'Transaction Date' },
      { name: 'Deleted At' },
      { name: 'Previous Principal (PHP)' },
      { name: 'New Principal (PHP)' },
      { name: 'Reason' },
    ],
    rows: deletedLoans.map((loan) => [
      loan.borrowerId,
      loan.borrowerName,
      loan.email ?? '',
      loan.guarantorName ?? '',
      loan.loanAmount,
      loan.interestRate,
      loan.paydayInterest,
      loan.createdAt,
      loan.transaction?.id ?? '',
      loan.transaction?.type ?? '',
      loan.transaction?.amount ?? '',
      loan.transaction?.date ?? '',
      loan.deletedAt,
      loan.transaction?.previousAmount ?? '',
      loan.transaction?.newAmount ?? '',
      loan.transaction?.reason ?? '',
    ]),
  })

  const fileHandle = await directory.getFileHandle(DATABASE_FILE_NAME, { create: true })
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(await workbook.xlsx.writeBuffer())
    await writable.close()
  } catch (error) {
    await writable.close()
    throw error
  }
}

export const readWorkbookMembers = async (directory: DatabaseDirectoryHandle) =>
  (await readWorkbookData(directory))?.members ?? null

export const writeWorkbookMembers = async (directory: DatabaseDirectoryHandle, members: Member[]) => {
  const existingData = await readWorkbookData(directory)
  await writeWorkbookData(
    directory,
    members,
    existingData?.accounts ?? [],
    existingData?.borrowers ?? [],
    existingData?.removedBorrowerTransactions ?? [],
    existingData?.profitTransfers ?? [],
    existingData?.profitCashouts ?? [],
    existingData?.deletedSavingsTransactions ?? [],
    existingData?.deletedProfitTransactions ?? [],
    existingData?.deletedLoans ?? [],
  )
}