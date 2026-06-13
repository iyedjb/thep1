import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import campaignsRouter from "./campaigns";
import keywordsRouter from "./keywords";
import trendsRouter from "./trends";
import generatorRouter from "./generator";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(dashboardRouter);
router.use(campaignsRouter);
router.use(keywordsRouter);
router.use(trendsRouter);
router.use(generatorRouter);

export default router;
