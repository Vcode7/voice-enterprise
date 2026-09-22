export const formatCurrency = (amount: number, symbol: string = '₹'): string => {
  const formatted = Math.abs(amount).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
  return `${amount < 0 ? '-' : ''}${symbol}${formatted}`;
};
