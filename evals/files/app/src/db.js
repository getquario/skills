// The billing store. In production this queries Postgres; here it returns one fixed record.
const invoices = {
  "INV-7731": {
    invoiceNo: "INV-7731",
    issuedOn: "2026-09-30",
    client: { name: "Bluefin Analytics LLC", email: "ap@bluefin.example" },
    items: [
      { description: "Data pipeline audit", hours: 12.5, rate: 180 },
      { description: "Dashboard rebuild", hours: 21.75, rate: 165 },
      { description: "Incident retro facilitation", hours: 3, rate: 210 },
    ],
  },
};

export async function getInvoice(id) {
  const invoice = invoices[id];
  if (!invoice) throw new Error(`no invoice ${id}`);
  return invoice;
}
