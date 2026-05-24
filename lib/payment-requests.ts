export type PaymentRequestStatus = "pending" | "paid" | "overdue";
export type PaymentRail = "Venmo" | "Cash App" | "PayPal" | "Zelle";

export type PaymentRequest = {
  id: string;
  roommate: string;
  utilityName: string;
  totalBill: number;
  userShare: number;
  dueDate: string;
  proofLabel: string;
  proofUrl: string;
  status: PaymentRequestStatus;
  paymentRail: PaymentRail;
  paymentTarget: string;
  lastReminderAt?: string;
};

const railBaseUrls: Record<Exclude<PaymentRail, "Zelle">, string> = {
  Venmo: "https://venmo.com/",
  "Cash App": "https://cash.app/",
  PayPal: "https://paypal.me/"
};

export function buildPaymentLink(request: PaymentRequest) {
  const note = encodeURIComponent(`${request.utilityName} share due ${request.dueDate}`);
  const amount = request.userShare.toFixed(2);

  if (request.paymentRail === "Zelle") {
    return `Zelle ${request.paymentTarget} with note: ${decodeURIComponent(note)}`;
  }

  const target = request.paymentTarget.replace(/^[@$]/, "");
  const base = railBaseUrls[request.paymentRail];

  if (request.paymentRail === "Venmo") return `${base}${target}?txn=pay&amount=${amount}&note=${note}`;
  if (request.paymentRail === "Cash App") return `${base}$${target}/${amount}`;
  return `${base}${target}/${amount}`;
}

export function getRequestStatus(request: PaymentRequest, today = new Date()): PaymentRequestStatus {
  if (request.status === "paid") return "paid";
  const due = new Date(`${request.dueDate}T23:59:59`);
  return due < today ? "overdue" : "pending";
}
