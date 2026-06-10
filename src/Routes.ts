import { Router } from "express";
import importadexRoutes from "./routes/importadex/importadex.routes";

const router: Router = Router();

router.use("/importadex", importadexRoutes);

export default router;
