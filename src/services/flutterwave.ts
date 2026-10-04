export const FLUTTERWAVE_PRICING = {
  monthly: {
    amount: 9.99,
    ngn: 15000,
    interval: 'month',
    label: '$9.99 / month',
    ngnLabel: '₦15,000 / month',
    savings: null,
  },
  yearly: {
    amount: 99,
    ngn: 150000,
    interval: 'year',
    label: '$99 / year',
    ngnLabel: '₦150,000 / year',
    savings: 'Save $20.88/year (17% off)',
  },
} as const;
