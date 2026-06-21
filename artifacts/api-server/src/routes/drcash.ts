import { Router } from "express";
import { requireAuth } from "./auth";
import { getDb } from "../lib/sqlite";
import https from "https";

const router = Router();

const DR_CASH_API = "drcash.io";

// Middleware to retrieve user's Dr. Cash token and attach it to req
async function attachDrCashToken(req: any, res: any, next: any) {
  const db = getDb();
  try {
    const user = await db.prepare("SELECT drcash_token FROM users WHERE id = ?").get(req.userId) as any;
    if (!user || !user.drcash_token) {
      res.status(400).json({ error: "token_missing", message: "API Token do Dr. Cash não configurado." });
      return;
    }
    req.drcashToken = user.drcash_token;
    next();
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao obter token do Dr. Cash: " + err.message });
  }
}

// Helper to call the real Dr. Cash API
function drCashRequest(token: string, path: string, method: "GET" | "POST" | "DELETE" = "GET", body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : undefined;
    const options: https.RequestOptions = {
      hostname: DR_CASH_API,
      path,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        Origin: "https://affiliate.dr.cash",
        Referer: "https://affiliate.dr.cash/",
      },
    };
    if (postData) {
      options.headers = {
        ...options.headers,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      };
    }
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON from Dr. Cash API: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Dr. Cash API timeout"));
    });
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

function drCashGet(token: string, path: string): Promise<any> {
  return drCashRequest(token, path, "GET");
}

// In-memory postback settings
let drcashSettings = {
  postback: {
    url: "https://s2s.ratoeiraads.com.br/s2s/11353-d2dac3ed-23f3-4752-8434-4ee5c0d8588a?orderid={uuid}&product={offer}&amount={payment}&cy={currency}&status={status}&subid1={sub1}&subid2={sub2}&subid3={sub3}&subid4={sub4}&subid5={sub5}",
    triggers: {
      new: true,
      confirmed: true,
      rejected: true,
      trash: false,
    },
  },
};

// ─── USER TOKEN ENDPOINTS ───────────────────────────────────────────────────

// GET /drcash/token - get the logged in user's API token (or null if not configured)
router.get("/drcash/token", requireAuth, async (req: any, res) => {
  const db = getDb();
  try {
    const user = await db.prepare("SELECT drcash_token FROM users WHERE id = ?").get(req.userId) as any;
    res.json({ token: user?.drcash_token || null });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao carregar token do Dr. Cash: " + err.message });
  }
});

// POST /drcash/token - validate and save user's API token
router.post("/drcash/token", requireAuth, async (req: any, res) => {
  const { token } = req.body;
  if (!token) {
    res.status(400).json({ error: "Token é obrigatório" });
    return;
  }

  try {
    // Validate the token against the real Dr. Cash API
    const data = await drCashRequest(token, "/v1/profile", "GET");
    if (data?.status === "BAD_REQUEST" || !data?.payload?.item) {
      res.status(400).json({ error: "Token inválido ou não autorizado pelo Dr. Cash" });
      return;
    }

    // Save token to database
    const db = getDb();
    await db.prepare("UPDATE users SET drcash_token = ? WHERE id = ?").run(token, req.userId);
    res.json({ success: true, token });
  } catch (err: any) {
    res.status(400).json({ error: "Falha ao validar o token com o Dr. Cash: " + err.message });
  }
});

// DELETE /drcash/token - disconnect/delete user's API token
router.delete("/drcash/token", requireAuth, async (req: any, res) => {
  const db = getDb();
  try {
    await db.prepare("UPDATE users SET drcash_token = NULL WHERE id = ?").run(req.userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao remover token do Dr. Cash: " + err.message });
  }
});

// ─── PROFILE & BALANCE ────────────────────────────────────────────────────────

// GET /drcash/profile - real profile from Dr. Cash API
router.get("/drcash/profile", requireAuth, attachDrCashToken, async (req: any, res) => {
  try {
    const data = await drCashGet(req.drcashToken, "/v1/profile");
    const profile = data?.payload?.item;
    if (!profile) {
      res.status(502).json({ error: "Could not fetch profile from Dr. Cash" });
      return;
    }
    res.json({
      id: profile.id,
      name: profile.full_name || "TImoteo Dias Azevedo",
      email: profile.email || "timoteo.info@gmail.com",
      phone: profile.phone,
      lang: profile.lang,
      geo: profile.geo_code,
      managerId: profile.manager_id,
    });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// GET /drcash/balance - real balance from Dr. Cash API
router.get("/drcash/balance", requireAuth, attachDrCashToken, async (req: any, res) => {
  try {
    const data = await drCashGet(req.drcashToken, "/v1/balance");
    const items = data?.payload?.items || [];
    res.json({ items });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// GET /drcash/wallets - real wallets from Dr. Cash API
router.get("/drcash/wallets", requireAuth, attachDrCashToken, async (req: any, res) => {
  try {
    const data = await drCashGet(req.drcashToken, "/v1/wallet?limit=20");
    if (data?.status === "BAD_REQUEST") {
      res.status(400).json({ error: data?.payload?.message || "Error fetching wallets" });
      return;
    }
    const items = data?.payload?.items || [];
    res.json(items);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// POST /drcash/wallets - create a wallet on Dr. Cash API (with fallback indicator)
router.post("/drcash/wallets", requireAuth, attachDrCashToken, async (req: any, res) => {
  try {
    const data = await drCashRequest(req.drcashToken, "/v1/wallet", "POST", req.body);
    if (data?.status === "OK" || data?.payload?.id) {
      res.json({ success: true, wallet: data?.payload?.item || data?.payload });
      return;
    }
    res.json({ success: false, error: data?.payload?.message || "Method not allowed by API token" });
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

// DELETE /drcash/wallets/:id - delete a wallet on Dr. Cash API
router.delete("/drcash/wallets/:id", requireAuth, attachDrCashToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const data = await drCashRequest(req.drcashToken, `/v1/wallet/${id}`, "DELETE");
    if (data?.status === "BAD_REQUEST") {
      res.status(400).json({ error: data?.payload?.message || "Error deleting wallet" });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ─── OFFERS ───────────────────────────────────────────────────────────────────

// GET /drcash/offers - proxy real offers from Dr. Cash API
router.get("/drcash/offers", requireAuth, attachDrCashToken, async (req: any, res) => {
  try {
    const {
      search,
      geo,
      category,
      page = "0",
      limit = "30",
      sortBy = "rank",
      sortDir = "ASC",
    } = req.query;

    // Build query string for Dr. Cash API
    const params = new URLSearchParams();
    params.set("limit", String(Math.min(Number(limit), 100)));
    params.set("offset", String(Number(page) * Number(limit)));
    if (search) params.set("search", search as string);
    if (geo && geo !== "all") params.set("geo_code", (geo as string).toUpperCase());
    if (category && category !== "all") params.set("category_id", category as string);
    if (sortBy) params.set("sort_by", sortBy as string);
    if (sortDir) params.set("sort_dir", sortDir as string);

    const data = await drCashGet(req.drcashToken, `/v1/offer?${params.toString()}`);

    if (data?.status === "BAD_REQUEST") {
      res.status(400).json({ error: data?.payload?.message || "Bad request to Dr. Cash API" });
      return;
    }

    const items = data?.payload?.items || [];
    const total = data?._meta?.total || items.length;

    // Normalize to our internal format
    const offers = items.map((o: any) => ({
      id: o.id,
      name: o.name,
      nameComposite: o.name_composite,
      category: o.category_id,
      geo: Array.isArray(o.geo_code) ? o.geo_code : [o.geo_code],
      payout: o.approved || 0,
      currency: o.currency || "USD",
      price: o.price,
      priceCurrency: o.price_currency,
      model: o.decision_id === 1 ? "CPA" : o.decision_id === 2 ? "CPL" : "COD",
      approvalRate: o.rate ? parseFloat(o.rate.toFixed(2)) : 0,
      status: o.status === 2 ? "active" : "inactive",
      availability: o.availability, // 1=exclusive, 2=public
      rank: o.rank,
      description: o.description,
      imageUrl: o.img_product_url,
      avatarUrl: o.img_avatar_url,
      pills: o.pills,
      transit: o.transit,
      apiIframe: o.api_iframe,
      link: o.link,
      materialLink: o.material_link,
      rule: o.rule,
      source: o.source,
      updatedAt: o.updated_at,
      createdAt: o.created_at,
    }));

    res.json({ offers, total, page: Number(page), limit: Number(limit) });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// GET /drcash/offers/:id - single offer detail
router.get("/drcash/offers/:id", requireAuth, attachDrCashToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const data = await drCashGet(req.drcashToken, `/v1/offer/${id}`);
    if (data?.status === "BAD_REQUEST") {
      res.status(404).json({ error: "Offer not found" });
      return;
    }
    const o = data?.payload?.item || data?.payload;
    res.json(o);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ─── FILTERS ──────────────────────────────────────────────────────────────────

// GET /drcash/categories - real categories from Dr. Cash API
router.get("/drcash/categories", requireAuth, attachDrCashToken, async (req: any, res) => {
  try {
    const data = await drCashGet(req.drcashToken, "/v1/filter/category");
    const items = data?.payload?.items || [];
    res.json(items);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// GET /drcash/countries - real countries from Dr. Cash API
router.get("/drcash/countries", requireAuth, attachDrCashToken, async (req: any, res) => {
  try {
    const data = await drCashGet(req.drcashToken, "/v1/filter/country");
    const items = data?.payload?.items || [];
    res.json(items);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ─── STREAMS ──────────────────────────────────────────────────────────────────

// GET /drcash/streams - real streams (campaigns) from Dr. Cash API
router.get("/drcash/streams", requireAuth, attachDrCashToken, async (req: any, res) => {
  try {
    const { page = "0", limit = "20" } = req.query;
    const params = new URLSearchParams();
    params.set("limit", String(Math.min(Number(limit), 100)));
    params.set("offset", String(Number(page) * Number(limit)));

    const data = await drCashGet(req.drcashToken, `/v1/stream?${params.toString()}`);
    if (data?.status === "BAD_REQUEST") {
      res.status(400).json({ error: data?.payload?.message });
      return;
    }
    const items = data?.payload?.items || [];
    const total = data?._meta?.total || items.length;
    res.json({ streams: items, total });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ─── SETTINGS ─────────────────────────────────────────────────────────────────

// GET /drcash/settings
router.get("/drcash/settings", requireAuth, attachDrCashToken, (req, res) => {
  res.json(drcashSettings);
});

// POST /drcash/settings
router.post("/drcash/settings", requireAuth, attachDrCashToken, (req, res) => {
  const { url, triggers } = req.body;
  if (url !== undefined) drcashSettings.postback.url = url;
  if (triggers !== undefined) drcashSettings.postback.triggers = triggers;
  res.json({ success: true, message: "Definições guardadas com sucesso!", settings: drcashSettings });
});

// GET /drcash/offers/:id/templates - real templates for an offer
router.get("/drcash/offers/:id/templates", requireAuth, attachDrCashToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const data = await drCashGet(req.drcashToken, `/v1/template?offer_id=${id}&limit=50`);
    if (data?.status === "BAD_REQUEST") {
      res.status(400).json({ error: data?.payload?.message || "Error fetching templates" });
      return;
    }
    const items = data?.payload?.items || [];
    res.json(items);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// GET /drcash/domains - real domains list
router.get("/drcash/domains", requireAuth, attachDrCashToken, async (req: any, res) => {
  try {
    const data = await drCashGet(req.drcashToken, "/v1/domain?limit=100");
    if (data?.status === "BAD_REQUEST") {
      res.status(400).json({ error: data?.payload?.message || "Error fetching domains" });
      return;
    }
    const items = data?.payload?.items || [];
    res.json(items);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// POST /drcash/streams - create campaign on Dr. Cash
router.post("/drcash/streams", requireAuth, attachDrCashToken, async (req: any, res) => {
  try {
    const data = await drCashRequest(req.drcashToken, "/v1/stream", "POST", req.body);
    if (data?.status === "BAD_REQUEST") {
      res.status(400).json({ error: data?.payload?.message || "Failed to create stream" });
      return;
    }
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// GET /drcash/offers/top - proxy top offers from Dr. Cash API
router.get("/drcash/offers/top", requireAuth, attachDrCashToken, async (req: any, res) => {
  try {
    const { type = "1", limit = "10" } = req.query;
    const data = await drCashGet(req.drcashToken, `/v1/offer/top?type=${type}&limit=${limit}`);
    if (data?.status === "BAD_REQUEST") {
      res.status(400).json({ error: data?.payload?.message || "Error fetching top offers" });
      return;
    }
    const items = data?.payload?.items || [];
    res.json(items);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
