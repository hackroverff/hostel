/* Small deterministic sample data shared by the jsdom suites. */
function pad2(n) { return String(n).padStart(2, '0'); }
function thisMk() { const n = new Date(); return n.getFullYear() + '-' + pad2(n.getMonth() + 1); }
function mkAdd(mk, delta) {
  const p = mk.split('-').map(Number);
  const x = new Date(p[0], p[1] - 1 + delta, 1);
  return x.getFullYear() + '-' + pad2(x.getMonth() + 1);
}

function seedFixture() {
  const cur = thisMk();
  const L = 'prop_ladies', M = 'prop_mens';
  const now = new Date().toISOString();
  const roomList = [
    { id: 'room_a101', propertyId: L, number: '101', floor: 0, sharing: 4, beds: 4, rent: 5200, ac: 'AC' },
    { id: 'room_a102', propertyId: L, number: '102', floor: 0, sharing: 3, beds: 3, rent: 4800, ac: 'Non-AC' },
    { id: 'room_b201', propertyId: M, number: '201', floor: 1, sharing: 2, beds: 2, rent: 4500, ac: 'Non-AC' },
    { id: 'room_b301', propertyId: M, number: '301', floor: 2, sharing: 2, beds: 2, rent: 6000, ac: 'AC' }
  ];
  const beds = [
    { id: 'bed_a101_1', roomId: 'room_a101', label: 'Bed 1', status: 'occupied', residentId: 'res_anjali' },
    { id: 'bed_a101_2', roomId: 'room_a101', label: 'Bed 2', status: 'occupied', residentId: 'res_kavya' },
    { id: 'bed_a101_3', roomId: 'room_a101', label: 'Bed 3', status: 'vacant', residentId: null },
    { id: 'bed_a101_4', roomId: 'room_a101', label: 'Bed 4', status: 'vacant', residentId: null },
    { id: 'bed_a102_1', roomId: 'room_a102', label: 'Bed 1', status: 'vacant', residentId: null },
    { id: 'bed_a102_2', roomId: 'room_a102', label: 'Bed 2', status: 'vacant', residentId: null },
    { id: 'bed_a102_3', roomId: 'room_a102', label: 'Bed 3', status: 'vacant', residentId: null },
    { id: 'bed_b201_1', roomId: 'room_b201', label: 'Bed 1', status: 'occupied', residentId: 'res_arun' },
    { id: 'bed_b201_2', roomId: 'room_b201', label: 'Bed 2', status: 'vacant', residentId: null },
    { id: 'bed_b301_1', roomId: 'room_b301', label: 'Bed 1', status: 'vacant', residentId: null },
    { id: 'bed_b301_2', roomId: 'room_b301', label: 'Bed 2', status: 'vacant', residentId: null }
  ];
  const base = {
    photo: '', status: 'Active', vacatingDate: '', notes: '',
    refundAmount: 0, refundDate: '', depositRefunded: false
  };
  const residents = [
    Object.assign({}, base, {
      id: 'res_anjali', name: 'Anjali Ramesh', phone: '9840012345',
      guardianName: 'Ramesh Kumar', guardianPhone: '9840098765', college: 'Anna University',
      idType: 'Aadhaar', idNumber: '4321 8765 2967',
      propertyId: L, roomId: 'room_a101', bedId: 'bed_a101_1',
      joiningDate: mkAdd(cur, -4) + '-01', rent: 5200, proRate: false,
      depositAmount: 10000, depositReceived: true
    }),
    Object.assign({}, base, {
      id: 'res_kavya', name: 'Kavya Balaji', phone: '9840054321',
      guardianName: 'Balaji S', guardianPhone: '9840076543', college: 'Ethiraj College',
      idType: 'Aadhaar', idNumber: '1122 3344 5566',
      propertyId: L, roomId: 'room_a101', bedId: 'bed_a101_2',
      joiningDate: mkAdd(cur, -3) + '-01', rent: 5200, proRate: false,
      depositAmount: 5000, depositReceived: true
    }),
    Object.assign({}, base, {
      id: 'res_arun', name: 'Arun Kumar', phone: '9884076543',
      guardianName: 'Kumar V', guardianPhone: '9884011223', college: 'TCS Siruseri',
      idType: 'PAN', idNumber: 'ABCDE1234F',
      propertyId: M, roomId: 'room_b201', bedId: 'bed_b201_1',
      joiningDate: mkAdd(cur, -2) + '-01', rent: 4500, proRate: false,
      depositAmount: 0, depositReceived: false
    })
  ];

  let rc = 0;
  const receipt = (month, amount, mode) => ({
    id: 'rcpt_' + (++rc), date: month + '-05', amount: amount, mode: mode,
    note: '', createdAt: now
  });
  const payments = [];
  const addDue = (residentId, month, due, receipts) => {
    payments.push({
      id: 'pay_' + residentId.slice(4) + '_' + month.replace('-', ''),
      residentId: residentId, month: month, rent: due, electricity: null,
      electricityManual: false, due: due, receipts: receipts || [],
      createdAt: now
    });
  };

  // Anjali: two paid months, one partial, two unpaid (incl. this month)
  addDue('res_anjali', mkAdd(cur, -4), 5200, [receipt(mkAdd(cur, -4), 5200, 'UPI')]);
  addDue('res_anjali', mkAdd(cur, -3), 5200, [receipt(mkAdd(cur, -3), 5200, 'Cash')]);
  addDue('res_anjali', mkAdd(cur, -2), 5200, [receipt(mkAdd(cur, -2), 2600, 'Cash')]);
  addDue('res_anjali', mkAdd(cur, -1), 5200, []);
  addDue('res_anjali', cur, 5200, []);

  // Kavya: paid, paid, partial, unpaid
  addDue('res_kavya', mkAdd(cur, -3), 5200, [receipt(mkAdd(cur, -3), 5200, 'UPI')]);
  addDue('res_kavya', mkAdd(cur, -2), 5200, [receipt(mkAdd(cur, -2), 5200, 'Bank transfer')]);
  addDue('res_kavya', mkAdd(cur, -1), 5200, [receipt(mkAdd(cur, -1), 3000, 'Cash')]);
  addDue('res_kavya', cur, 5200, []);

  // Arun: paid, unpaid, unpaid
  addDue('res_arun', mkAdd(cur, -2), 4500, [receipt(mkAdd(cur, -2), 4500, 'UPI')]);
  addDue('res_arun', mkAdd(cur, -1), 4500, []);
  addDue('res_arun', cur, 4500, []);

  const expenses = [
    {
      id: 'exp_1', propertyId: L, date: cur + '-03', category: 'Electricity',
      amount: 2400, note: 'EB bill', createdAt: now
    },
    {
      id: 'exp_2', propertyId: M, date: cur + '-04', category: 'Groceries',
      amount: 1800, note: 'Rice and oil', createdAt: now
    }
  ];

  return {
    version: 1,
    properties: [
      { id: L, name: 'Sathvika MV Ladies Hostel', rent: 5200, advance: 5200, electricity: { mode: 'split', amount: 0 } },
      { id: M, name: 'Sathvika MV Men\u2019s Hostel', rent: 4500, advance: 4500, electricity: { mode: 'fixed', amount: 0 } }
    ],
    rooms: roomList,
    beds: beds,
    residents: residents,
    payments: payments,
    expenses: expenses,
    electricityBills: [],
    settings: {
      dueDay: 5,
      ownerName: 'Sathvika Reddy',
      upi: 'sathvika@okhdfcbank',
      waTemplate: 'Hello {name}, your hostel rent of \u20B9{balance} for {month} is pending. Please pay by {date}. UPI: {upi}. Thank you.',
      propertyNote: '',
      largeText: false
    },
    meta: {
      lastRunMonth: cur,
      lastBackup: null,
      createdAt: now,
      firstMonthMode: 'prorate'
    }
  };
}

module.exports = { seedFixture, thisMk, mkAdd };
