import type ExcelJS from 'exceljs'

export type SavingsContribution = { amount: number; date: string }
export type SavingsWithdrawal = { amount: number; date: string; reason: string }
export type Member = {
  name: string
  accountEmail?: string
  initialSavings: number
  initialSavingsDate: string
  contributions: SavingsContribution[]
  withdrawals: SavingsWithdrawal[]
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
  type: 'loan' | 'interest' | 'interest-payment'
  amount: number
  date: string
}

export type Borrower = {
  id: string
  name: string
  email?: string
  loanAmount: number
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
): Promise<{ members: Member[]; accounts: DatabaseAccount[]; borrowers: Borrower[] } | null> => {
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
    })
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
  workbook.getWorksheet('Borrowers')?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const id = String(row.getCell(1).value ?? '').trim()
    const name = String(row.getCell(2).value ?? '').trim()
    if (!id || !name) return
    const loanAmount = Number(row.getCell(6).value) || 0
    const paydayInterestValue = row.getCell(4).value
    const savedPaydayInterest = Number(paydayInterestValue)
    const paydayInterest = paydayInterestValue === null
      || paydayInterestValue === undefined
      || paydayInterestValue === ''
      || !Number.isFinite(savedPaydayInterest)
      || savedPaydayInterest < 0
      ? loanAmount * 0.03
      : savedPaydayInterest
    const transactionsValue = String(row.getCell(7).value ?? '').trim()
    let transactions: LoanTransaction[] = []
    if (transactionsValue) {
      try {
        const parsedTransactions = JSON.parse(transactionsValue)
        if (Array.isArray(parsedTransactions)) {
          transactions = parsedTransactions.filter((transaction): transaction is LoanTransaction => Boolean(transaction)
            && typeof transaction.id === 'string'
            && (transaction.type === 'loan' || transaction.type === 'interest' || transaction.type === 'interest-payment')
            && Number.isFinite(Number(transaction.amount))
            && typeof transaction.date === 'string')
            .map((transaction) => ({
              id: String(transaction.id),
              type: transaction.type === 'interest' || transaction.type === 'interest-payment' ? transaction.type : 'loan',
              amount: Number(transaction.amount),
              date: String(transaction.date),
            }))
        }
      } catch {
        transactions = []
      }
    }
    borrowers.push({
      id,
      name,
      email: String(row.getCell(3).value ?? '').trim(),
      loanAmount,
      paydayInterest,
      createdAt: getCellDate(row.getCell(5).value),
      transactions,
    })
  })

  return { members: [...members.values()], accounts, borrowers }
}

export const writeWorkbookData = async (
  directory: DatabaseDirectoryHandle,
  members: Member[],
  accounts: DatabaseAccount[],
  borrowers: Borrower[] = [],
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
  contributionsSheet.addRow(['Member', 'Date', 'Amount'])
  members.forEach((member) => member.contributions.forEach((contribution) => {
    contributionsSheet.addRow([member.name, contribution.date, contribution.amount])
  }))

  const withdrawalsSheet = workbook.addWorksheet('Withdrawals')
  withdrawalsSheet.addRow(['Member', 'Date', 'Amount', 'Reason'])
  members.forEach((member) => member.withdrawals.forEach((withdrawal) => {
    withdrawalsSheet.addRow([member.name, withdrawal.date, withdrawal.amount, withdrawal.reason])
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
  borrowersSheet.addRow(['ID', 'Name', 'Email', 'Payday Interest (PHP)', 'Created At', 'Loan Amount (PHP)', 'Loan Transactions (JSON)'])
  borrowers.forEach((borrower) => borrowersSheet.addRow([
    borrower.id,
    borrower.name,
    borrower.email ?? '',
    borrower.paydayInterest,
    borrower.createdAt,
    borrower.loanAmount,
    JSON.stringify(borrower.transactions ?? []),
  ]))

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
  await writeWorkbookData(directory, members, existingData?.accounts ?? [])
}