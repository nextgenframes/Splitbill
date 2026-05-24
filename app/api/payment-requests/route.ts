import { NextResponse } from "next/server";
import { z } from "zod";
import { buildPaymentLink, type PaymentRail, type PaymentRequest } from "@/lib/payment-requests";

const requestSchema = z.object({
  bill: z.object({
    id: z.string().default("bill_demo"),
    utilityName: z.string(),
    totalBill: z.number(),
    dueDate: z.string(),
    proofLabel: z.string(),
    proofUrl: z.string().default("#")
  }),
  roommates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      share: z.number(),
      paymentRail: z.enum(["Venmo", "Cash App", "PayPal", "Zelle"]),
      paymentTarget: z.string()
    })
  )
});

export async function POST(request: Request) {
  const payload = requestSchema.parse(await request.json());

  const paymentRequests = payload.roommates.map<PaymentRequest>((roommate) => ({
    id: `req_${payload.bill.id}_${roommate.id}`,
    roommate: roommate.name,
    utilityName: payload.bill.utilityName,
    totalBill: payload.bill.totalBill,
    userShare: roommate.share,
    dueDate: payload.bill.dueDate,
    proofLabel: payload.bill.proofLabel,
    proofUrl: payload.bill.proofUrl,
    status: "pending",
    paymentRail: roommate.paymentRail as PaymentRail,
    paymentTarget: roommate.paymentTarget
  }));

  return NextResponse.json({
    paymentRequests: paymentRequests.map((paymentRequest) => ({
      ...paymentRequest,
      paymentUrlOrInstructions: buildPaymentLink(paymentRequest)
    })),
    reminders: paymentRequests.map((paymentRequest) => ({
      paymentRequestId: paymentRequest.id,
      roommate: paymentRequest.roommate,
      scheduled: [
        { offsetDays: -3, label: "3 days before due date" },
        { offsetDays: 0, label: "due date reminder" },
        { offsetDays: 2, label: "overdue reminder" }
      ]
    }))
  });
}
