import { Transaction, Budget } from '../../types';
import { isThisMonth, isThisWeek } from '../utils/dateUtils';
import { formatCurrency } from '../utils/currencyFormatter';

export interface CategorySummary {
  category: string;
  total: number;
  percentage: number;
  count: number;
}

export interface SpendingOverview {
  totalIncome: number;
  totalExpense: number;
  netBalance: number;
  transactionCount: number;
  categoryBreakdown: CategorySummary[];
}

export interface BudgetStatus {
  budget: Budget;
  spent: number;
  percentage: number;
  remaining: number;
  isOverBudget: boolean;
  isNearLimit: boolean;
}

export class AnalyticsEngine {
  public static calculateOverview(
    transactions: Transaction[],
    period: 'this_month' | 'this_week' | 'all' = 'this_month'
  ): SpendingOverview {
    const filtered = transactions.filter((t) => {
      if (period === 'this_month') return isThisMonth(t.date);
      if (period === 'this_week') return isThisWeek(t.date);
      return true;
    });

    let totalIncome = 0;
    let totalExpense = 0;
    const categoryTotals: Record<string, { total: number; count: number }> = {};

    filtered.forEach((t) => {
      if (t.transactionType === 'income') {
        totalIncome += t.amount;
      } else if (t.transactionType === 'expense') {
        totalExpense += t.amount;
        const cat = t.category || 'Other';
        if (!categoryTotals[cat]) {
          categoryTotals[cat] = { total: 0, count: 0 };
        }
        categoryTotals[cat].total += t.amount;
        categoryTotals[cat].count += 1;
      }
    });

    const categoryBreakdown: CategorySummary[] = Object.entries(categoryTotals)
      .map(([category, data]) => ({
        category,
        total: data.total,
        count: data.count,
        percentage: totalExpense > 0 ? Math.round((data.total / totalExpense) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    return {
      totalIncome,
      totalExpense,
      netBalance: totalIncome - totalExpense,
      transactionCount: filtered.length,
      categoryBreakdown,
    };
  }

  public static calculateBudgetStatuses(transactions: Transaction[], budgets: Budget[]): BudgetStatus[] {
    const thisMonthTx = transactions.filter((t) => isThisMonth(t.date) && t.transactionType === 'expense');

    return budgets.map((b) => {
      const spent = thisMonthTx
        .filter((t) => (t.category || 'Other').toLowerCase() === b.category.toLowerCase())
        .reduce((sum, t) => sum + t.amount, 0);

      const percentage = b.amount > 0 ? Math.min(100, Math.round((spent / b.amount) * 100)) : 0;
      const remaining = b.amount - spent;

      return {
        budget: b,
        spent,
        percentage,
        remaining,
        isOverBudget: spent > b.amount,
        isNearLimit: percentage >= 80 && spent <= b.amount,
      };
    });
  }

  public static generateInsights(transactions: Transaction[], budgets: Budget[], symbol: string = '₹'): string[] {
    const insights: string[] = [];
    const overview = this.calculateOverview(transactions, 'this_month');

    if (transactions.length === 0) {
      return ['Start recording expenses or income by voice to get automated AI insights!'];
    }

    if (overview.netBalance > 0) {
      insights.push(`Great job! You have saved ${formatCurrency(overview.netBalance, symbol)} so far this month.`);
    } else if (overview.netBalance < 0) {
      insights.push(`Attention: Expenses exceed income by ${formatCurrency(Math.abs(overview.netBalance), symbol)} this month.`);
    }

    if (overview.categoryBreakdown.length > 0) {
      const topCat = overview.categoryBreakdown[0];
      insights.push(`You spent the most on ${topCat.category} (${formatCurrency(topCat.total, symbol)} - ${topCat.percentage}% of total).`);
    }

    const thisMonthExpenses = transactions.filter((t) => isThisMonth(t.date) && t.transactionType === 'expense');
    if (thisMonthExpenses.length > 0) {
      const largest = thisMonthExpenses.reduce((max, t) => (t.amount > max.amount ? t : max), thisMonthExpenses[0]);
      insights.push(
        `Your largest single expense this month was ${formatCurrency(largest.amount, symbol)} at ${largest.merchant || largest.category || 'Merchant'}.`
      );
    }

    const budgetStatuses = this.calculateBudgetStatuses(transactions, budgets);
    budgetStatuses.forEach((bs) => {
      if (bs.isOverBudget) {
        insights.push(`⚠️ Budget Exceeded: You have spent ${formatCurrency(bs.spent, symbol)} of your ${formatCurrency(bs.budget.amount, symbol)} ${bs.budget.category} budget.`);
      } else if (bs.isNearLimit) {
        insights.push(`⚡ Budget Warning: ${bs.budget.category} is at ${bs.percentage}% of monthly limit.`);
      }
    });

    return insights;
  }
}
