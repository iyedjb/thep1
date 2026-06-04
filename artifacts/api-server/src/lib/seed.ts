import bcrypt from "bcryptjs";
import { getDb } from "./sqlite";
import { logger } from "./logger";

export function seedDb(): void {
  const db = getDb();

  const userCount = (db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }).count;
  if (userCount > 0) {
    logger.info("Database already seeded, skipping.");
    return;
  }

  logger.info("Seeding database...");

  const passwordHash = bcrypt.hashSync("admin123", 10);
  db.prepare(`INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)`).run(
    "admin@adsintelligence.com",
    "Admin Silva",
    passwordHash
  );

  const campaigns = [
    { name: "Brand - Genérico", status: "ativo", budget: 5000, cpc: 1.24, ctr: 6.15, roas: 5.20, conversions: 148 },
    { name: "Performance Max", status: "ativo", budget: 8000, cpc: 0.98, ctr: 4.82, roas: 4.10, conversions: 115 },
    { name: "Search - Produtos", status: "ativo", budget: 3500, cpc: 1.55, ctr: 5.40, roas: 3.80, conversions: 87 },
    { name: "Outros", status: "pausado", budget: 1200, cpc: 2.10, ctr: 2.90, roas: 2.50, conversions: 62 },
  ];
  for (const c of campaigns) {
    db.prepare(`INSERT INTO campaigns (name, status, budget, cpc, ctr, roas, conversions) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(c.name, c.status, c.budget, c.cpc, c.ctr, c.roas, c.conversions);
  }

  const months = ["Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez", "Jan", "Fev", "Mar", "Abr", "Mai"];
  const clicksData = [3200, 3800, 4100, 3600, 4500, 5200, 4800, 5600, 6100, 5800, 6400, 7200];
  const conversionsData = [120, 145, 160, 138, 175, 198, 182, 215, 234, 220, 248, 275];
  const costData = [3960, 4712, 5084, 4464, 5580, 6448, 5952, 6944, 7564, 7192, 7936, 8928];

  const now = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - (29 - i));
    const dateStr = d.toISOString().split("T")[0];
    const idx = Math.floor(i / 2.5) % 12;
    const clicks = Math.round(clicksData[idx] / 25 + Math.random() * 40 - 20);
    const convs = Math.round(conversionsData[idx] / 25 + Math.random() * 5 - 2);
    const cost = Math.round((costData[idx] / 25 + Math.random() * 50 - 25) * 100) / 100;
    db.prepare(`INSERT INTO performance_data (date, clicks, conversions, cost) VALUES (?, ?, ?, ?)`)
      .run(dateStr, Math.max(clicks, 10), Math.max(convs, 1), Math.max(cost, 5));
  }

  const keywords = [
    { keyword: "tênis nike masculino", search_volume: 49500, competition: "alta", cpc: 2.35, location: "Brasil", period: "12 meses" },
    { keyword: "comprar tênis online", search_volume: 33100, competition: "alta", cpc: 1.98, location: "São Paulo", period: "12 meses" },
    { keyword: "tênis adidas feminino", search_volume: 27200, competition: "média", cpc: 1.65, location: "Brasil", period: "12 meses" },
    { keyword: "promoção tênis esportivo", search_volume: 18400, competition: "média", cpc: 1.20, location: "Brasil", period: "12 meses" },
    { keyword: "loja de calçados", search_volume: 14800, competition: "baixa", cpc: 0.85, location: "Rio de Janeiro", period: "12 meses" },
  ];

  const trendBase = [22000, 24000, 28000, 26000, 30000, 45000, 38000, 32000, 35000, 33000, 31000, 36000];

  for (const kw of keywords) {
    const result = db.prepare(
      `INSERT INTO keywords (keyword, search_volume, competition, cpc, location, period) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(kw.keyword, kw.search_volume, kw.competition, kw.cpc, kw.location, kw.period);
    const kwId = Number(result.lastInsertRowid);

    for (let m = 0; m < 12; m++) {
      const vol = Math.round(trendBase[m] * (kw.search_volume / 49500) * (0.85 + Math.random() * 0.3));
      db.prepare(`INSERT INTO keyword_trends (keyword_id, month, volume) VALUES (?, ?, ?)`)
        .run(kwId, months[m], vol);
    }
  }

  logger.info("Database seeded successfully.");
}
