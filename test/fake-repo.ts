import type { Repo } from '../src/repo';

/** Repo palsu untuk tes handler; `overrides` mengganti method yang sedang diuji. */
export function fakeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    setOpeningBalance: async () => 1,
    addExpenseOrIncome: async () => 1,
    addTransfer: async () => 1,
    getBalances: async () => ({ tunai: 0, bank: 0 }),
    undoLast: async () => null,
    redoLast: async () => null,
    getHistory: async () => [],
    editTransaction: async () => null,
    deleteTransaction: async () => null,
    getSummary: async () => ({ income: 0, expense: 0, txCount: 0 }),
    setBudget: async () => {},
    getBudgetFor: async () => null,
    getExpenseUsed: async () => 0,
    getLedger: async () => [],
    getCarryIn: async () => [],
    getExpensesInRange: async () => [],
    getBudgetsUpTo: async () => [],
    ...overrides,
  };
}
