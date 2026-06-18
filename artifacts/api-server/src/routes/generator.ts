import { Router } from "express";
import { requireAuth } from "./auth";
import fs from "fs";
import path from "path";
import { logger } from "../lib/logger";

const router = Router();

router.post("/publish-bridge", requireAuth, (req, res) => {
  const { htmlContent, fileName } = req.body;
  if (!htmlContent || !fileName) {
    res.status(400).json({ error: "Missing htmlContent or fileName" });
    return;
  }

  try {
    const targetDir = path.resolve(process.cwd(), "../ads-intelligence/public");
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filePath = path.join(targetDir, fileName);
    fs.writeFileSync(filePath, htmlContent, "utf8");
    logger.info({ filePath }, "Bridge page published successfully");

    res.json({
      success: true,
      url: `/${fileName}`,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "Failed to publish bridge page");
    res.status(500).json({ error: `Failed to publish: ${err.message}` });
  }
});

router.delete("/delete-bridge", requireAuth, (req, res) => {
  const { fileName } = req.body;
  if (!fileName) {
    res.status(400).json({ error: "Missing fileName" });
    return;
  }

  try {
    const targetDir = path.resolve(process.cwd(), "../ads-intelligence/public");
    const filePath = path.join(targetDir, fileName);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info({ filePath }, "Bridge page deleted from server successfully");
    }

    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err: err.message }, "Failed to delete bridge page");
    res.status(500).json({ error: `Failed to delete: ${err.message}` });
  }
});

export default router;
