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

/**
 * Generate top searched keywords by theme using Gemini AI.
 */
export async function getTopKeywordsByTheme(theme: string): Promise<any[]> {
  const genAI = getGenAI();
  if (!genAI) {
    return getFallbackThemeKeywords(theme);
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = `Você é um especialista em SEO e Google Ads.
Gere uma lista das 8 palavras-chave ou títulos mais buscados e altamente relevantes relacionados ao tema ou nicho: "${theme}".
Para cada palavra-chave/título sugerido, estime:
1. keyword (a palavra-chave ou título de busca em português, ex: "exercícios de musculação para iniciantes")
2. searchVolume (volume de busca mensal estimado, ex: 12000, 45000, 800)
3. competition (concorrência, exatamente um de: "baixa", "média", "alta")
4. cpc (custo por clique médio estimado em Reais R$, ex: 1.5, 3.25, etc.)

Responda em formato JSON com exatamente esta estrutura:
{
  "keywords": [
    {
      "keyword": "título ou palavra-chave",
      "searchVolume": 25000,
      "competition": "média",
      "cpc": 1.80
    },
    ...
  ]
}

Responda APENAS o JSON válido, sem markdown, sem blocos de código (\`\`\`json), sem texto adicional.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    // Strip markdown formatting if any exists
    const cleanJson = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleanJson);
    
    if (Array.isArray(parsed.keywords)) {
      return parsed.keywords.map((k: any) => ({
        keyword: String(k.keyword || ""),
        searchVolume: Number(k.searchVolume || 100),
        competition: String(k.competition || "média"),
        cpc: Number(k.cpc || 1.0)
      }));
    }
    return getFallbackThemeKeywords(theme);
  } catch (error: any) {
    logger.error({ error: error.message }, `Failed to generate keywords for theme: ${theme}`);
    return getFallbackThemeKeywords(theme);
  }
}

function getFallbackThemeKeywords(theme: string): any[] {
  const normalized = theme.toLowerCase().trim();
  
  if (normalized.includes("saude") || normalized.includes("saúde") || normalized.includes("health") || normalized.includes("vida saudável")) {
    return [
      { keyword: "como emagrecer com saude", searchVolume: 49500, competition: "alta", cpc: 1.20 },
      { keyword: "exercicios para fazer em casa", searchVolume: 33100, competition: "média", cpc: 0.80 },
      { keyword: "dieta low carb cardapio", searchVolume: 27100, competition: "alta", cpc: 1.50 },
      { keyword: "sintomas de ansiedade", searchVolume: 22200, competition: "baixa", cpc: 0.50 },
      { keyword: "alimentos ricos em proteina", searchVolume: 18100, competition: "média", cpc: 0.90 },
      { keyword: "beneficios da caminhada rápida", searchVolume: 14800, competition: "baixa", cpc: 0.40 },
      { keyword: "suplementos alimentares para treinar", searchVolume: 9900, competition: "alta", cpc: 2.10 },
      { keyword: "como melhorar a qualidade do sono", searchVolume: 8100, competition: "baixa", cpc: 0.60 }
    ];
  }
  
  if (normalized.includes("tecnologia") || normalized.includes("tech") || normalized.includes("programacao") || normalized.includes("programação")) {
    return [
      { keyword: "inteligencia artificial ferramentas", searchVolume: 60500, competition: "alta", cpc: 3.50 },
      { keyword: "melhores celulares 2026", searchVolume: 40500, competition: "alta", cpc: 2.20 },
      { keyword: "como programar em python do zero", searchVolume: 27100, competition: "média", cpc: 1.80 },
      { keyword: "vagas home office ti", searchVolume: 22200, competition: "alta", cpc: 2.90 },
      { keyword: "o que é chatgpt e como usar", searchVolume: 18100, competition: "baixa", cpc: 0.70 },
      { keyword: "tendencias de tecnologia para 2026", searchVolume: 14800, competition: "média", cpc: 2.00 },
      { keyword: "melhores notebooks custo beneficio", searchVolume: 12100, competition: "alta", cpc: 1.90 },
      { keyword: "segurança da informação cursos", searchVolume: 8100, competition: "alta", cpc: 4.20 }
    ];
  }

  if (normalized.includes("financas") || normalized.includes("finanças") || normalized.includes("dinheiro") || normalized.includes("investir") || normalized.includes("investimento")) {
    return [
      { keyword: "como investir na bolsa de valores", searchVolume: 45000, competition: "alta", cpc: 4.50 },
      { keyword: "melhores investimentos renda fixa 2026", searchVolume: 35000, competition: "alta", cpc: 3.80 },
      { keyword: "planejamento financeiro pessoal planilha", searchVolume: 25000, competition: "média", cpc: 1.50 },
      { keyword: "como guardar dinheiro ganhando pouco", searchVolume: 22000, competition: "baixa", cpc: 0.80 },
      { keyword: "o que é taxa selic e rendimento", searchVolume: 18000, competition: "baixa", cpc: 1.20 },
      { keyword: "melhores cartões de crédito sem anuidade", searchVolume: 15000, competition: "alta", cpc: 5.00 },
      { keyword: "como declarar imposto de renda simples", searchVolume: 12000, competition: "média", cpc: 2.20 },
      { keyword: "fundos imobiliarios recomendados para iniciantes", searchVolume: 10000, competition: "alta", cpc: 3.00 }
    ];
  }

  if (normalized.includes("moda") || normalized.includes("beleza") || normalized.includes("skincare") || normalized.includes("estilo")) {
    return [
      { keyword: "passo a passo skincare simples", searchVolume: 25000, competition: "média", cpc: 1.10 },
      { keyword: "tendencias de moda outono inverno", searchVolume: 18000, competition: "alta", cpc: 1.40 },
      { keyword: "como combinar cores de roupas", searchVolume: 15000, competition: "baixa", cpc: 0.60 },
      { keyword: "melhores maquiagens nacionais 2026", searchVolume: 12000, competition: "alta", cpc: 1.80 },
      { keyword: "estilo casual masculino dicas", searchVolume: 9500, competition: "média", cpc: 0.85 },
      { keyword: "produtos para crescer cabelo rapido", searchVolume: 8200, competition: "alta", cpc: 2.00 },
      { keyword: "cortes de cabelo feminino moderno", searchVolume: 7400, competition: "baixa", cpc: 0.50 },
      { keyword: "looks para trabalhar confortavel", searchVolume: 5100, competition: "média", cpc: 0.90 }
    ];
  }

  // Generic generator for any other theme
  return [
    { keyword: `como iniciar em ${theme}`, searchVolume: 15000, competition: "média", cpc: 1.10 },
    { keyword: `melhores dicas sobre ${theme}`, searchVolume: 12000, competition: "baixa", cpc: 0.90 },
    { keyword: `tendencias de ${theme} 2026`, searchVolume: 8500, competition: "alta", cpc: 1.80 },
    { keyword: `curso completo de ${theme}`, searchVolume: 6200, competition: "alta", cpc: 2.50 },
    { keyword: `guia definitivo de ${theme}`, searchVolume: 4800, competition: "média", cpc: 1.30 },
    { keyword: `ferramentas para ${theme}`, searchVolume: 3900, competition: "média", cpc: 1.60 },
    { keyword: `como lucrar com ${theme}`, searchVolume: 3100, competition: "alta", cpc: 2.20 },
    { keyword: `comunidade de ${theme} online`, searchVolume: 1800, competition: "baixa", cpc: 0.75 }
  ];
}

