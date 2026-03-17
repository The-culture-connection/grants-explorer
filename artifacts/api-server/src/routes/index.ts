import { Router, type IRouter } from "express";
import healthRouter from "./health";
import grantsRouter from "./grants";
import indexingRouter from "./indexing";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(grantsRouter);
router.use(indexingRouter);

export default router;
