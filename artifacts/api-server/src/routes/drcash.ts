import { Router } from "express";
import { requireAuth } from "./auth";
import https from "https";

const router = Router();

const DR_CASH_API = "drcash.io";
const DR_CASH_TOKEN = process.env.DR_CASH_API_TOKEN || "NGNLMDJMOGETMDQ2NI00OTY3LWIWZJATMDYYNDC5YTBHMDEW";

// Helper to call the real Dr. Cash API
function drCashRequest(path: string, method: "GET" | "POST" | "DELETE" = "GET", body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : undefined;
    const options: https.RequestOptions = {
      hostname: DR_CASH_API,
      path,
      method,
      headers: {
        Authorization: `Bearer ${DR_CASH_TOKEN}`,
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

function drCashGet(path: string): Promise<any> {
  return drCashRequest(path, "GET");
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

// GET /drcash/token - get the default API token for prepopulation
router.get("/drcash/token", requireAuth, (req, res) => {
  res.json({ token: DR_CASH_TOKEN });
});

// ─── PROFILE & BALANCE ────────────────────────────────────────────────────────

// GET /drcash/profile - real profile from Dr. Cash API
router.get("/drcash/profile", requireAuth, async (req, res) => {
  try {
    const data = await drCashGet("/v1/profile");
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
router.get("/drcash/balance", requireAuth, async (req, res) => {
  try {
    const data = await drCashGet("/v1/balance");
    const items = data?.payload?.items || [];
    res.json({ items });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// GET /drcash/wallets - real wallets from Dr. Cash API
router.get("/drcash/wallets", requireAuth, async (req, res) => {
  try {
    const data = await drCashGet("/v1/wallet?limit=20");
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
router.post("/drcash/wallets", requireAuth, async (req, res) => {
  try {
    const data = await drCashRequest("/v1/wallet", "POST", req.body);
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
router.delete("/drcash/wallets/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const data = await drCashRequest(`/v1/wallet/${id}`, "DELETE");
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
router.get("/drcash/offers", requireAuth, async (req, res) => {
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

    const data = await drCashGet(`/v1/offer?${params.toString()}`);

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
router.get("/drcash/offers/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const data = await drCashGet(`/v1/offer/${id}`);
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
router.get("/drcash/categories", requireAuth, async (req, res) => {
  try {
    const data = await drCashGet("/v1/filter/category");
    const items = data?.payload?.items || [];
    res.json(items);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// GET /drcash/countries - real countries from Dr. Cash API
router.get("/drcash/countries", requireAuth, async (req, res) => {
  try {
    const data = await drCashGet("/v1/filter/country");
    const items = data?.payload?.items || [];
    res.json(items);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ─── STREAMS ──────────────────────────────────────────────────────────────────

// GET /drcash/streams - real streams (campaigns) from Dr. Cash API
router.get("/drcash/streams", requireAuth, async (req, res) => {
  try {
    const { page = "0", limit = "20" } = req.query;
    const params = new URLSearchParams();
    params.set("limit", String(Math.min(Number(limit), 100)));
    params.set("offset", String(Number(page) * Number(limit)));

    const data = await drCashGet(`/v1/stream?${params.toString()}`);
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
router.get("/drcash/settings", requireAuth, (req, res) => {
  res.json(drcashSettings);
});

// POST /drcash/settings
router.post("/drcash/settings", requireAuth, (req, res) => {
  const { url, triggers } = req.body;
  if (url !== undefined) drcashSettings.postback.url = url;
  if (triggers !== undefined) drcashSettings.postback.triggers = triggers;
  res.json({ success: true, message: "Definições guardadas com sucesso!", settings: drcashSettings });
});

// GET /drcash/offers/:id/templates - real templates for an offer
router.get("/drcash/offers/:id/templates", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const data = await drCashGet(`/v1/template?offer_id=${id}&limit=50`);
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
router.get("/drcash/domains", requireAuth, async (req, res) => {
  try {
    const data = await drCashGet("/v1/domain?limit=100");
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
router.post("/drcash/streams", requireAuth, async (req, res) => {
  try {
    const data = await drCashRequest("/v1/stream", "POST", req.body);
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
router.get("/drcash/offers/top", requireAuth, async (req, res) => {
  try {
    const { type = "1", limit = "10" } = req.query;
    const data = await drCashGet(`/v1/offer/top?type=${type}&limit=${limit}`);
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
