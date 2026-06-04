import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import campaignsRouter from "./campaigns";
import keywordsRouter from "./keywords";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(dashboardRouter);
router.use(campaignsRouter);
router.use(keywordsRouter);

export default router;
