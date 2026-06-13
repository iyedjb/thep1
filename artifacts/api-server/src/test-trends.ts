import { GoogleGenerativeAI } from "@google/generative-ai";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../../../.env");

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx === -1) continue;
    const key = t.slice(0, idx).trim();
    const val = t.slice(idx + 1).trim();
    if (val && !process.env[key]) process.env[key] = val;
  }
}

async function run() {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set.");
    return;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  // Using gemini-2.0-flash as it supports internet research
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const keyword = "marketing digital";
  const prompt = `Você é um especialista em Google Trends. Pesquise sobre o interesse de busca real para a palavra-chave "${keyword}" nos últimos 12 meses.
Forneça os seguintes dados em formato JSON estrito:
{
  "interestOverTime": [
    {"date": "Jun", "value": 75},
    {"date": "Jul", "value": 80}
  ],
  "interestByRegion": [
    {"region": "Brasil", "value": 100},
    {"region": "Portugal", "value": 15}
  ],
  "relatedQueries": [
    "o que é marketing digital",
    "curso marketing digital"
  ]
}
Nota: interestOverTime deve conter 12 meses completos terminando no mês atual (ex: Jun 2025 a Maio 2026, ou similar). interestByRegion deve listar os 5 principais países/regiões de busca.

Responda APENAS o JSON, sem markdown, sem code blocks, sem texto adicional.`;

  try {
    console.log(`Querying trends for "${keyword}"...`);
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    console.log("Raw Response:");
    console.log(text);
    const parsed = JSON.parse(text);
    console.log("Parsed JSON:", parsed);
  } catch (err: any) {
    console.error("Error:", err.message || err);
  }
}

run();
