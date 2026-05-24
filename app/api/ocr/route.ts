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
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY missing" }, { status: 400 });
  }

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const base64 = bytes.toString("base64");
  const mimeType = file.type || "application/octet-stream";
  const isPdf = mimeType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  try {
    const visionExtraction = await extractWithModel([
      { text: "Extract structured fields from this utility bill image or PDF." },
      { inline_data: { mime_type: mimeType, data: base64 } }
    ]);

    let fallbackExtraction: BillExtraction | undefined;
    if (isPdf && visionExtraction.needsManualReview) {
      const pdfText = await extractPdfText(bytes);
      if (pdfText) {
        fallbackExtraction = await extractWithModel([
          {
            text: `PDF text fallback. Extract fields from this utility bill text:\n\n${pdfText.slice(0, 24000)}`
          }
        ]);
        fallbackExtraction.source = "pdf_text_fallback";
      }
    }

    return NextResponse.json(mergeExtractions(visionExtraction, fallbackExtraction));
  } catch (error) {
    if (isGeminiUnavailable(error)) {
      return NextResponse.json({
        success: false,
        fallback: true,
        error: "AI extraction unavailable. Please enter bill details manually."
      });
    }

    throw error;
  }
}

async function extractWithModel(parts: Array<Record<string, unknown>>) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY ?? ""
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: extractionJsonSchema
        },
        systemInstruction: {
          parts: [
            {
              text:
                "You extract roommate utility bill data. Supported bill types only: electric, water, garbage, internet. Extract utility provider, bill type, total amount due, due date, billing period, and service address. Return empty string for fields not visible. Dates must be YYYY-MM-DD. Confidence values must be 0 to 1. Mark needsManualReview true when any important field is unclear."
            }
          ]
        }
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Gemini OCR request failed");
  }

  const payload = await response.json();
  const rawText = payload.candidates?.[0]?.content?.parts?.find((part: { text?: string }) => typeof part.text === "string")?.text;
  if (!rawText) {
    throw new Error("Gemini OCR returned empty response");
  }

  return validateExtraction(billExtractionSchema.parse(JSON.parse(rawText)));
}

function isGeminiUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("404") || message.includes("429");
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
