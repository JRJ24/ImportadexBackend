import { Router } from "express";
import { importadexClientPortalController } from "../../controllers/importadex/importadex-client-portal.controller";
import { importadexClientController } from "../../controllers/importadex/importadex-client.controller";
import { importadexController } from "../../controllers/importadex/importadex.controller";
import { attachImportadexUser, requireImportadexAdmin, requireImportadexClientManager } from "../../middlewares/importadexAdmin";
import { loginRateLimit } from "../../middlewares/loginRateLimit";
import { processFile } from "../../middlewares/processFiles";

const router = Router();

router.use(attachImportadexUser);

router.post("/client-portal/login", loginRateLimit, importadexClientPortalController.requestLogin);
router.post("/client-portal/verify-otp", loginRateLimit, importadexClientPortalController.verifyOtp);
router.get("/client-portal/me", importadexClientPortalController.me);
router.get("/client-portal/operations", importadexClientPortalController.listOperations);
router.get("/client-portal/operations/:id", importadexClientPortalController.getOperation);
router.post("/client-portal/operations/:id/attachments", processFile, importadexClientPortalController.uploadAttachments);

router.get("/operations", importadexController.listOperations);
router.post("/operations", importadexController.createOperation);
router.get("/operations/:id", importadexController.getOperation);
router.patch("/operations/:id", importadexController.updateOperation);
router.patch("/operations/:id/status", importadexController.updateStatus);
router.get("/operations/:id/events", importadexController.listEvents);
router.post("/operations/:id/events", importadexController.createEvent);
router.get("/operations/:id/comments", importadexController.listComments);
router.post("/operations/:id/comments", importadexController.createComment);
router.get("/operations/:id/attachments", importadexController.listOperationAttachments);
router.post("/operations/:id/attachments", processFile, importadexController.uploadOperationAttachments);
router.post("/attachments/upload", processFile, importadexController.uploadOperationAttachments);

router.post("/clients/register", processFile, importadexClientController.register);
router.post("/clients", requireImportadexClientManager, processFile, importadexClientController.createByAdmin);
router.get("/clients/select", importadexClientController.listApprovedOptions);
router.get("/clients", requireImportadexClientManager, importadexClientController.list);
router.get("/clients/:id", requireImportadexClientManager, importadexClientController.get);
router.patch("/clients/:id/approve", requireImportadexClientManager, importadexClientController.approve);
router.patch("/clients/:id/reject", requireImportadexClientManager, importadexClientController.reject);
router.post("/clients/:id/commitment", requireImportadexClientManager, processFile, importadexClientController.uploadCommitment);

for (const key of ["containers", "customs-files", "incidents", "documents", "attachments"] as const) {
  const handlers = importadexController.tableHandlers(key);
  router.get(`/${key}`, handlers.list);
  router.post(`/${key}`, handlers.create);
  router.patch(`/${key}/:id`, handlers.update);
}

router.get("/shipments", (_req, res) => res.json({ ok: true, data: [] }));
router.get("/cargo-items", (_req, res) => res.json({ ok: true, data: [] }));
router.get("/catalogs", importadexController.catalogs);
router.post("/catalog-options", importadexController.createCatalogOption);
router.get("/dashboard", importadexController.dashboard);
router.get("/reports", importadexController.reports);
router.get("/email-logs", requireImportadexAdmin, importadexController.emailLogs);
router.get("/email-health", requireImportadexAdmin, importadexController.emailHealth);
router.post("/email-test", requireImportadexAdmin, importadexController.emailTest);

export default router;
