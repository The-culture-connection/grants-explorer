import { Router, type IRouter } from "express";
import healthRouter from "./health";
import grantsRouter from "./grants";
import indexingRouter from "./indexing";

const router: IRouter = Router();

router.use(healthRouter);
router.use(grantsRouter);
router.use(indexingRouter);

export default router;
