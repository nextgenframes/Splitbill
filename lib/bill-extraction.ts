import { z } from "zod";

export const billTypes = ["electric", "water", "garbage", "internet"] as const;

export const billExtractionSchema = z.object({
  provider: z.string().default(""),
  billType: z.enum(billTypes).default("electric"),
  amount: z.number().default(0),
  dueDate: z.string().default(""),
  billingPeriod: z.string().default(""),
  serviceAddress: z.string().default(""),
  confidence: z.object({
    provider: z.number().min(0).max(1).default(0),
    billType: z.number().min(0).max(1).default(0),
    amount: z.number().min(0).max(1).default(0),
    dueDate: z.number().min(0).max(1).default(0),
    billingPeriod: z.number().min(0).max(1).default(0),
    serviceAddress: z.number().min(0).max(1).default(0),
    overall: z.number().min(0).max(1).default(0)
  }),
  needsManualReview: z.boolean().default(true),
  validationIssues: z.array(z.string()).default([]),
  source: z.enum(["vision", "pdf_text_fallback", "merged", "demo"]).default("vision")
});

export type BillExtraction = z.infer<typeof billExtractionSchema>;

export const extractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    provider: { type: "string" },
    billType: { type: "string", enum: billTypes },
    amount: { type: "number" },
    dueDate: { type: "string" },
    billingPeriod: { type: "string" },
    serviceAddress: { type: "string" },
    confidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        provider: { type: "number" },
        billType: { type: "number" },
        amount: { type: "number" },
        dueDate: { type: "number" },
        billingPeriod: { type: "number" },
        serviceAddress: { type: "number" },
        overall: { type: "number" }
      },
      required: ["provider", "billType", "amount", "dueDate", "billingPeriod", "serviceAddress", "overall"]
    },
    needsManualReview: { type: "boolean" },
    validationIssues: {
      type: "array",
      items: { type: "string" }
    },
    source: { type: "string", enum: ["vision", "pdf_text_fallback", "merged", "demo"] }
  },
  required: [
    "provider",
    "billType",
    "amount",
    "dueDate",
    "billingPeriod",
    "serviceAddress",
    "confidence",
    "needsManualReview",
    "validationIssues",
    "source"
  ]
};

const supportedProviderHints = [
  "electric",
  "energy",
  "power",
  "gas",
  "water",
  "sewer",
  "waste",
  "garbage",
  "trash",
  "internet",
  "broadband",
  "fiber",
  "comcast",
  "xfinity",
  "att",
  "at&t",
  "verizon",
  "spectrum"
];

export function validateExtraction(extraction: BillExtraction): BillExtraction {
  const issues = new Set(extraction.validationIssues);
  const confidence = { ...extraction.confidence };

  if (!extraction.provider.trim()) issues.add("Utility provider missing.");
  if (!supportedProviderHints.some((hint) => `${extraction.provider} ${extraction.billType}`.toLowerCase().includes(hint))) {
    issues.add("Bill type/provider does not clearly match electric, water, garbage, or internet.");
    confidence.billType = Math.min(confidence.billType, 0.55);
  }

  if (!Number.isFinite(extraction.amount) || extraction.amount <= 0) {
    issues.add("Total amount missing or invalid.");
    confidence.amount = 0;
  }

  if (!isValidIsoDate(extraction.dueDate)) {
    issues.add("Due date missing or not YYYY-MM-DD.");
    confidence.dueDate = 0;
  }

  if (!extraction.billingPeriod.trim()) {
    issues.add("Billing period missing.");
    confidence.billingPeriod = 0;
  }

  if (!looksLikeAddress(extraction.serviceAddress)) {
    issues.add("Service address missing or unclear.");
    confidence.serviceAddress = Math.min(confidence.serviceAddress, 0.45);
  }

  const fieldScores = [
    confidence.provider,
    confidence.billType,
    confidence.amount,
    confidence.dueDate,
    confidence.billingPeriod,
    confidence.serviceAddress
  ];
  const overall = roundConfidence(Math.min(confidence.overall, average(fieldScores)));
  const needsManualReview = overall < 0.78 || issues.size > 0 || fieldScores.some((score) => score < 0.65);

  return {
    ...extraction,
    confidence: { ...confidence, overall },
    needsManualReview,
    validationIssues: Array.from(issues)
  };
}

export function mergeExtractions(primary: BillExtraction, fallback?: BillExtraction): BillExtraction {
  if (!fallback) return validateExtraction(primary);

  const merged: BillExtraction = { ...primary, confidence: { ...primary.confidence }, source: "merged" };
  const fields = ["provider", "billType", "amount", "dueDate", "billingPeriod", "serviceAddress"] as const;

  fields.forEach((field) => {
    const primaryValue = primary[field];
    const fallbackValue = fallback[field];
    const primaryScore = primary.confidence[field];
    const fallbackScore = fallback.confidence[field];
    const missing = typeof primaryValue === "string" ? !primaryValue.trim() : !primaryValue;

    if (fallbackScore > primaryScore + 0.12 || missing) {
      (merged[field] as never) = fallbackValue as never;
      merged.confidence[field] = fallbackScore;
    }
  });

  merged.validationIssues = [...primary.validationIssues, ...fallback.validationIssues];
  merged.confidence.overall = Math.max(primary.confidence.overall, fallback.confidence.overall);
  return validateExtraction(merged);
}

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time);
}

function looksLikeAddress(value: string) {
  return /\d+.+\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|way|ct|court|apt|unit)\b/i.test(value);
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundConfidence(value: number) {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}
