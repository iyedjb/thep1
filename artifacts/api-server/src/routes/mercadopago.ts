import { Router } from "express";
import { requireAuth } from "./auth";
import { getDb } from "../lib/sqlite";
import { logger } from "../lib/logger";
import {
  createPreference,
  createPixPayment,
  getPaymentDetails,
  getMercadoPagoConfiguration,
  verifyWebhookSignature,
} from "../lib/mercadopago";

const router = Router();

const PLANS = {
  starter: {
    name: "Essencial",
    monthlyPrice: 49.0,
    yearlyPrice: 470.0,
    description: "Para validar ofertas e começar uma operação de tráfego com clareza.",
    features: [
      "3 campanhas ativas",
      "20 presells com IA por mês",
      "Pesquisa de palavras-chave",
      "Google Trends integrado",
      "Suporte por e-mail",
    ],
  },
  pro: {
    name: "Profissional",
    monthlyPrice: 97.0,
    yearlyPrice: 930.0, // R$ 77.50/mês
    description: "Para afiliados profissionais e gestores de tráfego que buscam escala rápida.",
    features: [
      "Campanha ilimitadas no Google Ads",
      "Gerador de Presell com IA de alta conversão",
      "Inteligência Dr. Cash integrada",
      "Google Trends e Análise de Palavras-Chave",
      "Suporte prioritário via WhatsApp",
    ],
  },
  enterprise: {
    name: "Escala",
    monthlyPrice: 197.0,
    yearlyPrice: 1890.0, // R$ 157.50/mês
    description: "Para agências, equipes e grandes operações de tráfego pago.",
    features: [
      "Tudo do plano Pro",
      "Múltiplas contas do Google Ads integradas",
      "Geração em massa de Presells e landing pages",
      "Acesso à API e webhooks customizados",
      "Gerente de conta dedicado",
      "SLA garantido de 99.9%",
    ],
  },
};

type PaidPlanTier = keyof typeof PLANS;

function isPaidPlanTier(value: unknown): value is PaidPlanTier {
  return value === "starter" || value === "pro" || value === "enterprise";
}

function isBillingCycle(value: unknown): value is "monthly" | "yearly" {
  return value === "monthly" || value === "yearly";
}

/**
 * GET /api/subscription/plans
 * Returns available subscription plans and prices
 */
router.get("/subscription/plans", (_req, res) => {
  res.json({
    plans: PLANS,
    currency: "BRL",
  });
});

router.get("/mercadopago/config", (_req, res) => {
  res.json(getMercadoPagoConfiguration());
});

/**
 * POST /api/mercadopago/create-preference
 * Creates a Mercado Pago Checkout Pro preference for card/boleto/MP checkout
 */
router.post("/mercadopago/create-preference", requireAuth, async (req: any, res) => {
  const { planTier = "pro", billingCycle = "monthly" } = req.body;
  const userId = req.userId;

  if (!isPaidPlanTier(planTier) || !isBillingCycle(billingCycle)) {
    res.status(400).json({ error: "Plano ou período de cobrança inválido." });
    return;
  }

  const selectedPlan = PLANS[planTier as keyof typeof PLANS];
  const amount = billingCycle === "yearly" ? selectedPlan.yearlyPrice : selectedPlan.monthlyPrice;
  const db = getDb();

  try {
    const user = (await db.prepare("SELECT email, name FROM users WHERE id = ?").get(userId)) as any;
    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    const prefResult = await createPreference({
      userId,
      userEmail: user.email,
      userName: user.name,
      planTier,
      billingCycle,
      amount,
      description: `Assinatura ${selectedPlan.name} (${billingCycle === "yearly" ? "Anual" : "Mensal"})`,
    });

    // Store pending payment record in DB
    await db
      .prepare(
        `INSERT INTO payments 
         (user_id, mp_preference_id, status, transaction_amount, payer_email, plan_tier, billing_cycle)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(userId, prefResult.id, "pending", amount, user.email, planTier, billingCycle);

    res.json({
      success: true,
      preferenceId: prefResult.id,
      initPoint: prefResult.init_point,
      sandboxInitPoint: prefResult.sandbox_init_point,
      externalReference: prefResult.external_reference,
      publicKey: process.env.MERCADOPAGO_PUBLIC_KEY || "",
    });
  } catch (err: any) {
    logger.error({ userId, error: err.message }, "Failed to create checkout preference");
    res.status(500).json({ error: "Erro ao gerar preferências de pagamento: " + err.message });
  }
});

/**
 * POST /api/mercadopago/create-pix
 * Generates an instant Pix payment QR Code
 */
router.post("/mercadopago/create-pix", requireAuth, async (req: any, res) => {
  const { planTier = "pro", billingCycle = "monthly" } = req.body;
  const userId = req.userId;

  if (!isPaidPlanTier(planTier) || !isBillingCycle(billingCycle)) {
    res.status(400).json({ error: "Plano ou período de cobrança inválido." });
    return;
  }

  const selectedPlan = PLANS[planTier as keyof typeof PLANS];
  const amount = billingCycle === "yearly" ? selectedPlan.yearlyPrice : selectedPlan.monthlyPrice;
  const db = getDb();

  try {
    const user = (await db.prepare("SELECT email, name FROM users WHERE id = ?").get(userId)) as any;
    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    const pixResult = await createPixPayment({
      userId,
      userEmail: user.email,
      userName: user.name,
      planTier,
      billingCycle,
      amount,
      description: `Assinatura ${selectedPlan.name} via Pix (${billingCycle === "yearly" ? "Anual" : "Mensal"})`,
    });

    // Save Pix payment record in DB
    await db
      .prepare(
        `INSERT INTO payments 
         (user_id, mp_payment_id, status, status_detail, payment_method_id, transaction_amount, payer_email, plan_tier, billing_cycle, qr_code, qr_code_base64, ticket_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (mp_payment_id) DO UPDATE SET
           status = EXCLUDED.status,
           qr_code = EXCLUDED.qr_code,
           qr_code_base64 = EXCLUDED.qr_code_base64,
           updated_at = CURRENT_TIMESTAMP`
      )
      .run(
        userId,
        pixResult.payment_id,
        pixResult.status,
        pixResult.status_detail,
        "pix",
        amount,
        user.email,
        planTier,
        billingCycle,
        pixResult.qr_code,
        pixResult.qr_code_base64,
        pixResult.ticket_url || null
      );

    res.json({
      success: true,
      paymentId: pixResult.payment_id,
      status: pixResult.status,
      qrCode: pixResult.qr_code,
      qrCodeBase64: pixResult.qr_code_base64,
      ticketUrl: pixResult.ticket_url,
      amount,
      planTier,
    });
  } catch (err: any) {
    logger.error({ userId, error: err.message }, "Failed to create Pix payment");
    res.status(500).json({ error: "Erro ao gerar código Pix: " + err.message });
  }
});

/**
 * Helper function to handle upgrading user plan tier automatically
 */
async function upgradeUserSubscription(
  userId: number,
  planTier: string,
  paymentId: string,
  billingCycle: string = "monthly"
) {
  const db = getDb();
  
  // Calculate expiration date (30 days for monthly, 365 days for yearly)
  const daysToAdd = billingCycle === "yearly" ? 365 : 30;
  const expiresAt = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000).toISOString();

  await db
    .prepare(
      `UPDATE users 
       SET subscription_tier = ?, 
           subscription_status = 'active', 
           subscription_id = ?, 
           subscription_expires_at = ?
       WHERE id = ?`
    )
    .run(planTier, paymentId, expiresAt, userId);

  logger.info(
    { userId, planTier, paymentId, expiresAt },
    "User subscription automatically upgraded via Mercado Pago payment"
  );
}

/**
 * GET /api/mercadopago/verify-payment/:paymentId
 * Frontend polling or post-redirect auto-verification endpoint
 */
router.get("/mercadopago/verify-payment/:paymentId", requireAuth, async (req: any, res) => {
  const { paymentId } = req.params;
  const db = getDb();

  try {
    // First, check local payment record
    const localPayment = (await db
      .prepare("SELECT * FROM payments WHERE mp_payment_id = ? OR mp_preference_id = ? ORDER BY id DESC")
      .get(paymentId, paymentId)) as any;

    if (localPayment && Number(localPayment.user_id) !== Number(req.userId)) {
      res.status(403).json({ error: "Este pagamento não pertence à sua conta." });
      return;
    }

    if (!localPayment) {
      // Fetch details from Mercado Pago API directly
      const mpDetails = await getPaymentDetails(paymentId);
      if (mpDetails && mpDetails.status) {
        let userId = req.userId;
        let planTier = "pro";
        let billingCycle = "monthly";

        if (mpDetails.external_reference) {
          const parts = mpDetails.external_reference.split("_");
          if (parts[1]) userId = Number(parts[1]);
          if (parts[2]) planTier = parts[2];
          if (parts[3]) billingCycle = parts[3];
        }

        if (!userId || Number(userId) !== Number(req.userId)) {
          res.status(403).json({ error: "Não foi possível vincular este pagamento à sua conta." });
          return;
        }

        if (mpDetails.status === "approved") {
          await upgradeUserSubscription(userId, planTier, paymentId, billingCycle);
        }

        res.json({
          status: mpDetails.status,
          statusDetail: mpDetails.status_detail,
          approved: mpDetails.status === "approved",
          planTier,
        });
        return;
      }
    }

    if (!localPayment) {
      res.status(404).json({ error: "Pagamento não encontrado" });
      return;
    }

    // Check with Mercado Pago API for status update if still pending
    if (localPayment.status === "pending" || localPayment.status === "in_process") {
      try {
        const mpDetails = await getPaymentDetails(localPayment.mp_payment_id || paymentId);
        if (mpDetails && mpDetails.status && mpDetails.status !== localPayment.status) {
          // Update DB
          await db
            .prepare("UPDATE payments SET status = ?, status_detail = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(mpDetails.status, mpDetails.status_detail || null, localPayment.id);

          localPayment.status = mpDetails.status;
          localPayment.status_detail = mpDetails.status_detail;
        }
      } catch (err: any) {
        logger.warn({ error: err.message }, "Could not fetch updated status from Mercado Pago API");
      }
    }

    // Auto-upgrade if approved
    if (localPayment.status === "approved") {
      await upgradeUserSubscription(
        localPayment.user_id,
        localPayment.plan_tier,
        localPayment.mp_payment_id || paymentId,
        localPayment.billing_cycle
      );
    }

    res.json({
      status: localPayment.status,
      statusDetail: localPayment.status_detail,
      approved: localPayment.status === "approved",
      planTier: localPayment.plan_tier,
    });
  } catch (err: any) {
    logger.error({ paymentId, error: err.message }, "Failed to verify payment");
    res.status(500).json({ error: "Erro ao verificar status do pagamento: " + err.message });
  }
});

/**
 * POST /api/mercadopago/webhook
 * Secure Mercado Pago Webhook listener for automatic payment notifications
 */
router.post("/mercadopago/webhook", async (req, res) => {
  const xSignature = req.headers["x-signature"] as string | undefined;
  const xRequestId = req.headers["x-request-id"] as string | undefined;

  const topic = req.query.topic || req.query.type || req.body.type || req.body.action;
  const dataId = req.query["data.id"] || req.body.data?.id || req.body.id;

  logger.info({ topic, dataId, xRequestId }, "Received Mercado Pago Webhook notification");

  // Verify HMAC signature
  if (!xSignature || !verifyWebhookSignature(xSignature, xRequestId, String(dataId))) {
    logger.warn({ xSignature, xRequestId }, "Invalid Mercado Pago webhook signature");
    res.status(401).send("Invalid signature");
    return;
  }

  // Always acknowledge webhook immediately with 200 OK
  res.status(200).send("OK");

  if (!dataId) return;

  // Process payment notification asynchronously
  try {
    if (topic === "payment" || req.body.action === "payment.created" || req.body.action === "payment.updated") {
      const paymentDetails = await getPaymentDetails(String(dataId));

      if (paymentDetails && paymentDetails.status) {
        const db = getDb();
        const status = paymentDetails.status;
        const statusDetail = paymentDetails.status_detail;
        const mpPaymentId = String(paymentDetails.id);
        const externalRef = paymentDetails.external_reference || "";

        let userId: number | null = null;
        let planTier = "pro";
        let billingCycle = "monthly";

        if (externalRef.startsWith("usr_")) {
          const parts = externalRef.split("_");
          if (parts[1]) userId = Number(parts[1]);
          if (parts[2]) planTier = parts[2];
          if (parts[3]) billingCycle = parts[3];
        }

        // Update payment table entry
        await db
          .prepare(
            `INSERT INTO payments 
             (user_id, mp_payment_id, status, status_detail, payment_method_id, payment_type_id, transaction_amount, payer_email, plan_tier, billing_cycle)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (mp_payment_id) DO UPDATE SET
               status = EXCLUDED.status,
               status_detail = EXCLUDED.status_detail,
               updated_at = CURRENT_TIMESTAMP`
          )
          .run(
            userId,
            mpPaymentId,
            status,
            statusDetail || null,
            paymentDetails.payment_method_id || null,
            paymentDetails.payment_type_id || null,
            paymentDetails.transaction_amount || 0,
            paymentDetails.payer?.email || null,
            planTier,
            billingCycle
          );

        // Auto-upgrade user if status is approved
        if (status === "approved" && userId) {
          await upgradeUserSubscription(userId, planTier, mpPaymentId, billingCycle);
        }
      }
    }
  } catch (err: any) {
    logger.error({ error: err.message, dataId }, "Error processing Mercado Pago webhook payload");
  }
});

export default router;
