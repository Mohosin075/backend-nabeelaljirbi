import express from "express";
import { webhookController } from "../../../helpars/stripe/webhook/webhook.controller";

const router = express.Router();

// Webhook endpoint - no authentication needed
// Raw body parsing is handled in app.ts
router.post("/stripe", webhookController.stripeWebhookHandler);

export const WebhookRoutes = router;
