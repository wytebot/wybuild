export const FLUTTERWAVE_PRICING = {
  monthly: {
    amount: 10,
    interval: 'month',
    label: '$10 / month',
    savings: null,
  },
  yearly: {
    amount: 100,
    interval: 'year',
    label: '$100 / year',
    savings: 'Save $20/year (17% off)',
  },
} as const;
