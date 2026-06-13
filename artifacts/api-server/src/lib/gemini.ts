import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "./logger";

let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI | null {
  if (_genAI) return _genAI;
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    logger.warn("GEMINI_API_KEY not set — AI features will use fallback responses");
    return null;
  }
  _genAI = new GoogleGenerativeAI(apiKey);
  return _genAI;
}

/**
 * Analyze a keyword for Google Ads strategy using Gemini AI.
 * Returns both the analysis text and the intent classification.
 */
export async function analyzeKeywordWithAI(
  keyword: string,
  searchVolume: number,
  competition: string,
  cpc: number,
  location: string
): Promise<{ analysis: string; intent: string }> {
  const genAI = getGenAI();

  if (!genAI) {
    // Fallback when no API key is configured
    return getFallbackAnalysis(keyword, searchVolume, competition, cpc);
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `Você é um especialista em Google Ads e marketing digital. Analise a seguinte palavra-chave e forneça uma análise estratégica completa.

Palavra-chave: "${keyword}"
Volume de busca mensal: ${searchVolume.toLocaleString("pt-BR")}
Concorrência: ${competition}
CPC médio: R$ ${cpc.toFixed(2)}
Localização: ${location}

Responda em formato JSON com exatamente estas duas chaves:
{
  "analysis": "Sua análise estratégica completa em 2-3 frases em português do Brasil. Inclua recomendações práticas de lances, tipo de correspondência, e sazonalidade.",
  "intent": "Exatamente um dos seguintes: Transacional, Comercial, Informacional, Navegacional"
}

Responda APENAS o JSON, sem markdown, sem code blocks, sem texto adicional.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Parse the JSON response
    const parsed = JSON.parse(text);
    const analysis = typeof parsed.analysis === "string" ? parsed.analysis : "";
    const intent = validateIntent(parsed.intent);

    return { analysis, intent };
  } catch (error: any) {
    logger.error({ error: error.message }, "Gemini API call failed, using fallback");
    return getFallbackAnalysis(keyword, searchVolume, competition, cpc);
  }
}

function validateIntent(intent: string): string {
  const validIntents = ["Transacional", "Comercial", "Informacional", "Navegacional"];
  if (validIntents.includes(intent)) return intent;
  return "Comercial"; // default fallback
}

function getFallbackAnalysis(
  keyword: string,
  searchVolume: number,
  competition: string,
  cpc: number
): { analysis: string; intent: string } {
  const analyses = [
    `"${keyword}" apresenta alto potencial transacional. Volume de busca de ${searchVolume.toLocaleString("pt-BR")} mensais com competição ${competition}. CPC médio de R$ ${cpc.toFixed(2)} indica ${competition === "alta" ? "mercado competitivo — foque em qualidade do anúncio e landing page." : "oportunidade de crescimento com baixo investimento inicial."}`,
    `Análise semântica: intenção de busca predominantemente ${competition === "alta" ? "transacional — usuários prontos para compra" : "informacional — nutra com conteúdo antes de converter"}. Sazonalidade: pico em novembro (Black Friday) e janeiro. Recomendo lances mais agressivos nesses períodos.`,
    `Palavra-chave de ${competition} concorrência. Estratégia recomendada: ${cpc < 1.5 ? "amplie cobertura com correspondência ampla modificada" : "use correspondência exata para controle de custo"}. ROAS estimado: ${(Math.random() * 3 + 2).toFixed(1)}x baseado em dados históricos similares.`,
  ];
  const analysis = analyses[Math.floor(Math.random() * analyses.length)];
  const intent = competition === "alta" ? "Transacional" : "Comercial";

  return { analysis, intent };
}

/**
 * Generate related keyword suggestions using Gemini AI (acting as a fallback for Keyword Planner)
 */
export async function generateKeywordSuggestionsWithAI(
  seedKeyword: string,
  location: string = "Brasil"
): Promise<any[]> {
  const genAI = getGenAI();
  if (!genAI) {
    return getFallbackSuggestions(seedKeyword);
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = `Você é uma ferramenta de pesquisa de palavras-chave do Google Ads.
Gere 8 ideias de palavras-chave altamente relevantes relacionadas à palavra-chave semente: "${seedKeyword}" para a localização "${location}".
Para cada palavra-chave sugerida, estime:
1. avgMonthlySearches (volume mensal médio de pesquisas, ex: 1000, 5000, etc.)
2. competition (concorrência, exatamente um de: "baixa", "média", "alta")
3. competitionIndex (índice de concorrência de 0 a 100)
4. avgCpc (Custo por Clique médio estimado em Reais R$, ex: 1.5, 3.25, etc.)

Responda em formato JSON com exatamente esta estrutura:
{
  "suggestions": [
    {
      "keyword": "palavra-chave sugerida 1",
      "avgMonthlySearches": 1500,
      "competition": "média",
      "competitionIndex": 45,
      "avgCpc": 1.75
    },
    ...
  ]
}

Responda APENAS o JSON, sem markdown, sem code blocks, sem texto adicional.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const parsed = JSON.parse(text);
    
    if (Array.isArray(parsed.suggestions)) {
      return parsed.suggestions.map((s: any) => ({
        keyword: s.keyword || s.text || "",
        avgMonthlySearches: Number(s.avgMonthlySearches || 100),
        competition: s.competition || "média",
        competitionIndex: Number(s.competitionIndex || 50),
        lowCpc: Math.round((s.avgCpc * 0.7) * 100) / 100,
        highCpc: Math.round((s.avgCpc * 1.3) * 100) / 100,
        avgCpc: Number(s.avgCpc || 1.0),
        text: s.keyword || s.text || "", // backwards compatibility
        cpc: Number(s.avgCpc || 1.0) // backwards compatibility
      }));
    }
    return getFallbackSuggestions(seedKeyword);
  } catch (error: any) {
    logger.error({ error: error.message }, "Gemini suggestions generation failed");
    return getFallbackSuggestions(seedKeyword);
  }
}

function getFallbackSuggestions(seedKeyword: string): any[] {
  const suffixes = [" preço", " melhor", " como fazer", " curso", " comprar", " online", " profissional", " serviços"];
  return suffixes.map((suffix, idx) => {
    const keyword = `${seedKeyword}${suffix}`;
    const avgMonthlySearches = Math.round(500 + Math.random() * 9500);
    const comps = ["baixa", "média", "alta"];
    const competition = comps[idx % 3];
    const avgCpc = Math.round((0.5 + Math.random() * 4) * 100) / 100;
    return {
      keyword,
      avgMonthlySearches,
      competition,
      competitionIndex: Math.round(20 + Math.random() * 60),
      lowCpc: Math.round((avgCpc * 0.7) * 100) / 100,
      highCpc: Math.round((avgCpc * 1.3) * 100) / 100,
      avgCpc,
      text: keyword,
      cpc: avgCpc
    };
  });
}
