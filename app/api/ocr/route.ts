import OpenAI from "openai";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import { NextResponse } from "next/server";
import {
  billExtractionSchema,
  extractionJsonSchema,
  mergeExtractions,
  validateExtraction,
  type BillExtraction
} from "@/lib/bill-extraction";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 400 });
  }

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const base64 = bytes.toString("base64");
  const mimeType = file.type || "application/octet-stream";
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const isPdf = mimeType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const fileInput: ResponseInputContent = mimeType.startsWith("image/")
    ? {
        type: "input_image",
        detail: "high",
        image_url: `data:${mimeType};base64,${base64}`
      }
    : {
        type: "input_file",
        filename: file.name,
        file_data: `data:${mimeType};base64,${base64}`
      };

  const visionExtraction = await extractWithModel(openai, [
    { type: "input_text", text: "Extract structured fields from this utility bill image or PDF." },
    fileInput
  ]);

  let fallbackExtraction: BillExtraction | undefined;
  if (isPdf && visionExtraction.needsManualReview) {
    const pdfText = await extractPdfText(bytes);
    if (pdfText) {
      fallbackExtraction = await extractWithModel(openai, [
        {
          type: "input_text",
          text: `PDF text fallback. Extract fields from this utility bill text:\n\n${pdfText.slice(0, 24000)}`
        }
      ]);
      fallbackExtraction.source = "pdf_text_fallback";
    }
  }

  return NextResponse.json(mergeExtractions(visionExtraction, fallbackExtraction));
}

async function extractWithModel(openai: OpenAI, content: ResponseInputContent[]) {
  const response = await openai.responses.create({
    model: "gpt-4o-mini",
    instructions:
      "You extract roommate utility bill data. Supported bill types only: electric, water, garbage, internet. Extract utility provider, bill type, total amount due, due date, billing period, and service address. Return empty string for fields not visible. Dates must be YYYY-MM-DD. Confidence values must be 0 to 1. Mark needsManualReview true when any important field is unclear.",
    input: [{ role: "user", content }],
    text: {
      format: {
        type: "json_schema",
        name: "utility_bill_extraction",
        strict: true,
        schema: extractionJsonSchema
      }
    }
  });

  return validateExtraction(billExtractionSchema.parse(JSON.parse(response.output_text ?? "{}")));
}

async function extractPdfText(bytes: Buffer) {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    const result = await parser.getText();
    await parser.destroy();
    return result.text;
  } catch {
    return "";
  }
}
