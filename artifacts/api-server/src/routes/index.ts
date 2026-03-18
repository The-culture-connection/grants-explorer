import { Router, type IRouter } from "express";
import configRouter from "./config";
import healthRouter from "./health";
import grantsRouter from "./grants";
import indexingRouter from "./indexing";
import authRouter from "./auth";
import eventsRouter from "./events";

const router: IRouter = Router();

router.use(configRouter);
router.use(healthRouter);
router.use(authRouter);
router.use(grantsRouter);
router.use(indexingRouter);
router.use(eventsRouter);

export default router;
