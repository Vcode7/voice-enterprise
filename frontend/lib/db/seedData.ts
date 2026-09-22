import { Transaction, Receipt, Budget, Debt, DataEntryRecord } from '../../types';
import { getTodayString, getYesterdayString } from '../utils/dateUtils';
import {
  dbTransactions,
  dbReceipts,
  dbBudgets,
  dbDebts,
  dbDataEntries,
} from './models';
import { DEFAULT_MONITORING_DETAILS_TEMPLATE } from '../constants';

export const seedDemoDataToDb = async (): Promise<{
  transactionsCount: number;
  receiptsCount: number;
  budgetsCount: number;
  debtsCount: number;
  dataEntriesCount: number;
}> => {
  const today = getTodayString();
  const yesterday = getYesterdayString();

  const d = new Date();
  d.setDate(d.getDate() - 3);
  const threeDaysAgo = d.toISOString().split('T')[0];

  const d2 = new Date();
  d2.setDate(d2.getDate() - 5);
  const fiveDaysAgo = d2.toISOString().split('T')[0];

  const sampleTransactions: Transaction[] = [
    {
      id: `demo_tx_1`,
      amount: 17500,
      currency: 'INR',
      merchant: 'Company Corp',
      category: 'Salary',
      paymentMethod: 'Bank Transfer',
      transactionType: 'income',
      description: 'Internship Stipend Salary',
      transcript: 'I received 17500 as my internship salary.',
      date: today,
      createdAt: new Date().toISOString(),
    },
    {
      id: `demo_tx_2`,
      amount: 450,
      currency: 'INR',
      merchant: 'Fresh Grocery Supermarket',
      category: 'Groceries',
      paymentMethod: 'Amazon Pay',
      transactionType: 'expense',
      description: 'Paid ₹450 to Grocery Shop',
      transcript: 'I paid 450 rupees to the grocery shop using Amazon Pay.',
      date: today,
      createdAt: new Date().toISOString(),
    },
    {
      id: `demo_tx_3`,
      amount: 250,
      currency: 'INR',
      merchant: 'Burger & Beans Cafe',
      category: 'Food',
      paymentMethod: 'UPI',
      transactionType: 'expense',
      description: 'Lunch at Cafe',
      transcript: 'Spent 250 at cafe for lunch.',
      date: today,
      createdAt: new Date().toISOString(),
    },
    {
      id: `demo_tx_4`,
      amount: 699,
      currency: 'INR',
      merchant: 'Netflix',
      category: 'Subscriptions',
      paymentMethod: 'Credit Card',
      transactionType: 'expense',
      description: 'Monthly Premium Plan',
      transcript: 'Paid 699 for Netflix monthly subscription.',
      date: yesterday,
      createdAt: new Date().toISOString(),
    },
    {
      id: `demo_tx_5`,
      amount: 120,
      currency: 'INR',
      merchant: 'Indian Oil Petrol Pump',
      category: 'Fuel',
      paymentMethod: 'UPI',
      transactionType: 'expense',
      description: 'Bike Petrol Refill',
      transcript: 'Put 120 rupees petrol in bike.',
      date: yesterday,
      createdAt: new Date().toISOString(),
    },
    {
      id: `demo_tx_6`,
      amount: 2450,
      currency: 'INR',
      merchant: 'Trendy Outfitters',
      category: 'Shopping',
      paymentMethod: 'Debit Card',
      transactionType: 'expense',
      description: 'Casual Shirts and Jeans',
      transcript: 'Bought clothes for 2450 at shopping mall.',
      date: threeDaysAgo,
      createdAt: new Date().toISOString(),
    },
    {
      id: `demo_tx_7`,
      amount: 1200,
      currency: 'INR',
      merchant: 'Electricity Board',
      category: 'Bills',
      paymentMethod: 'Google Pay',
      transactionType: 'expense',
      description: 'Monthly Power Bill',
      transcript: 'Paid 1200 electricity bill via Google Pay.',
      date: fiveDaysAgo,
      createdAt: new Date().toISOString(),
    },
  ];

  const sampleReceipts: Receipt[] = [
    {
      id: `demo_rcpt_1`,
      receiptNumber: 'INV-1001',
      date: today,
      customerName: 'Aarav Sharma',
      customerPhone: '+91 98765 12345',
      customerAddress: '45 Industrial Estate, Sector 5, Bengaluru',
      customerGstin: '29ABCDE1234F1Z5',
      items: [
        { id: 'item_1', name: 'Basmati Rice Premium', hsnCode: '1006', quantity: 5, unit: 'kg', unitPrice: 110, lineTotal: 550 },
        { id: 'item_2', name: 'Sunflower Cooking Oil', hsnCode: '1512', quantity: 2, unit: 'litres', unitPrice: 160, lineTotal: 320 },
        { id: 'item_3', name: 'Toor Dal Grade A', hsnCode: '0713', quantity: 2, unit: 'kg', unitPrice: 140, lineTotal: 280 },
      ],
      subtotal: 1150,
      discount: 50,
      tax: 55,
      taxPercent: 5,
      taxType: 'gst',
      cgst: 27.5,
      sgst: 27.5,
      igst: 0,
      grandTotal: 1155,
      currency: 'INR',
      notes: 'Thank you for your business. Payment received via UPI.',
      format: 'basic_tax',
      transcript: '5 kg basmati rice at 110 per kg, 2 litres oil at 160, 2 kg dal at 140, discount 50 rupees, 5 percent GST.',
      createdAt: new Date().toISOString(),
    },
    {
      id: `demo_rcpt_2`,
      receiptNumber: 'INV-1002',
      date: yesterday,
      customerName: 'Pooja Verma',
      customerPhone: '+91 91234 56789',
      customerAddress: '12 Green Park, New Delhi',
      customerGstin: '07AAAAA0000A1Z5',
      items: [
        { id: 'item_4', name: 'Organic Almonds', hsnCode: '0802', quantity: 1, unit: 'kg', unitPrice: 850, lineTotal: 850 },
        { id: 'item_5', name: 'Pure Honey', hsnCode: '0409', quantity: 2, unit: 'bottles', unitPrice: 220, lineTotal: 440 },
      ],
      subtotal: 1290,
      discount: 0,
      tax: 154.8,
      taxPercent: 12,
      taxType: 'gst',
      cgst: 77.4,
      sgst: 77.4,
      igst: 0,
      grandTotal: 1444.8,
      currency: 'INR',
      notes: 'Freshly packed organic items.',
      format: 'standard',
      transcript: '1 kg almonds 850 rupees, 2 bottles honey 220 each, 12% GST.',
      createdAt: new Date().toISOString(),
    },
  ];

  const sampleBudgets: Budget[] = [
    { id: 'bud_1', category: 'Groceries', amount: 5000, period: 'monthly', createdAt: new Date().toISOString() },
    { id: 'bud_2', category: 'Food', amount: 3000, period: 'monthly', createdAt: new Date().toISOString() },
    { id: 'bud_3', category: 'Fuel', amount: 2000, period: 'monthly', createdAt: new Date().toISOString() },
    { id: 'bud_4', category: 'Shopping', amount: 4000, period: 'monthly', createdAt: new Date().toISOString() },
  ];

  const sampleDebts: Debt[] = [
    {
      id: 'debt_1',
      personName: 'Rohan (Colleague)',
      amount: 850,
      type: 'given',
      settled: false,
      notes: 'Team dinner share',
      date: today,
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'debt_2',
      personName: 'Amit (Gym Friend)',
      amount: 500,
      type: 'borrowed',
      settled: false,
      notes: 'Supplements advance payment',
      date: yesterday,
      updatedAt: new Date().toISOString(),
    },
  ];

  const sampleDataEntries: DataEntryRecord[] = [
    {
      id: 'entry_demo_1',
      templateId: DEFAULT_MONITORING_DETAILS_TEMPLATE.id,
      templateName: DEFAULT_MONITORING_DETAILS_TEMPLATE.name,
      fieldValues: {
        part_no: 'PRT-9042',
        description: 'Automotive Housing Bracket A',
        raw_material: 'Nylon 66 Glass Filled 30%',
        planned_production_date: today,
        batch_no: 'B-2026-08-A',
        shift: 'Shift 1 (Morning)',
        opening_counter: '14200',
        closing_counter: '14850',
        cycle_time: '38 sec',
        startup_time: '08:30 AM',
        operator_no: 'OP-502 (Ramesh)',
        no_of_cavities: '4',
        purge_weight: '320',
        runner_weight: '48',
      },
      tableRows: [
        {
          start_time: '08:30 AM',
          end_time: '09:30 AM',
          planned_qty: '100',
          produced_qty: '98',
          rejection: '2',
          remarks: 'Standard run',
        },
        {
          start_time: '09:30 AM',
          end_time: '10:30 AM',
          planned_qty: '100',
          produced_qty: '99',
          rejection: '1',
          remarks: 'Smooth operation',
        },
        {
          start_time: '10:30 AM',
          end_time: '11:30 AM',
          planned_qty: '100',
          produced_qty: '97',
          rejection: '3',
          remarks: 'Minor flash trim',
        },
      ],
      rawTranscript:
        'Part number PRT-9042, description Automotive Housing Bracket A, material Nylon 66, shift 1 morning, batch B-2026-08-A, opening counter 14200, closing 14850, cycle time 38 seconds, 4 cavities, operator Ramesh OP-502, purge weight 320g. Hourly logs: 8:30 to 9:30 planned 100 produced 98 reject 2, 9:30 to 10:30 planned 100 produced 99 reject 1.',
      date: today,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'entry_demo_2_flex',
      templateId: 'flexible',
      templateName: 'Flexible Voice Entry',
      isFlexible: true,
      title: 'Packaging Quality Audit Record',
      fieldValues: {
        'Inspector Name': 'Vikas',
        'Lot Number': 'LOT-8821',
        'Inspection Status': 'Passed Quality Check',
        'Humidity Level': '42%',
      },
      flexibleFields: [
        { id: 'f1', name: 'Inspector Name', value: 'Vikas' },
        { id: 'f2', name: 'Lot Number', value: 'LOT-8821' },
        { id: 'f3', name: 'Inspection Status', value: 'Passed Quality Check' },
        { id: 'f4', name: 'Humidity Level', value: '42%' },
      ],
      tableTitle: 'Sample Box Inspections',
      tableHeaders: ['Sample Box', 'Gross Wt (kg)', 'Defects Found', 'Status'],
      tableRows: [
        ['Box #1', '12.4', '0', 'Approved'],
        ['Box #2', '12.5', '0', 'Approved'],
        ['Box #3', '12.3', '1 (Dent)', 'Minor Rework'],
      ],
      rawTranscript:
        'Inspector Vikas, Lot number LOT-8821, inspection status passed, humidity 42%. Box inspections: Box 1 weight 12.4kg 0 defects approved, Box 2 weight 12.5kg 0 defects approved, Box 3 weight 12.3kg 1 dent minor rework.',
      date: yesterday,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  await dbTransactions.createMany(sampleTransactions);
  await dbReceipts.createMany(sampleReceipts);
  for (const b of sampleBudgets) {
    await dbBudgets.setBudget(b.category, b.amount, b.period);
  }
  for (const d of sampleDebts) {
    await dbDebts.recordDebt(d.personName, d.amount, d.type, d.notes, d.date);
  }
  await dbDataEntries.createMany(sampleDataEntries);

  return {
    transactionsCount: sampleTransactions.length,
    receiptsCount: sampleReceipts.length,
    budgetsCount: sampleBudgets.length,
    debtsCount: sampleDebts.length,
    dataEntriesCount: sampleDataEntries.length,
  };
};
