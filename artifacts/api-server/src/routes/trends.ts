import { Router } from "express";
import { requireAuth } from "./auth";
import { getGoogleTrendsData, getGoogleTrendsDemographics } from "../lib/trends-service";

const router = Router();

router.get("/trends/demographics", requireAuth, async (req: any, res): Promise<void> => {
  const keyword = req.query.keyword as string | undefined;

  if (!keyword) {
    res.status(400).json({ error: "keyword query parameter is required" });
    return;
  }

  try {
    const data = await getGoogleTrendsDemographics(keyword);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch demographic trends: " + error.message });
  }
});

router.get("/trends", requireAuth, async (req: any, res): Promise<void> => {
  const keyword = req.query.keyword as string | undefined;
  const geo = (req.query.geo as string) || "Global";
  const timeRange = (req.query.timeRange as string) || "12m";

  if (!keyword) {
    res.status(400).json({ error: "keyword query parameter is required" });
    return;
  }

  try {
    const data = await getGoogleTrendsData(keyword, geo, timeRange);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch trends data: " + error.message });
  }
});

export default router;
