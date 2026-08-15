import crypto from "crypto";
import { logger } from "./logger";

export interface CreatePreferenceOptions {
  userId: number;
  userEmail: string;
  userName?: string;
  planTier: "pro" | "enterprise";
  billingCycle: "monthly" | "yearly";
  amount: number;
  description: string;
}

export interface CreatePixOptions {
  userId: number;
  userEmail: string;
  userName?: string;
  planTier: "pro" | "enterprise";
  billingCycle: "monthly" | "yearly";
  amount: number;
  description: string;
}

export interface MPPreferenceResponse {
  id: string;
  init_point: string;
  sandbox_init_point: string;
  external_reference: string;
}

export interface MPPixResponse {
  payment_id: string;
  status: string;
  status_detail: string;
  qr_code: string;
  qr_code_base64: string;
  ticket_url?: string;
  external_reference: string;
}

const MP_BASE_URL = "https://api.mercadopago.com";

function getAccessToken(): string | null {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  return token && token.trim().length > 0 ? token.trim() : null;
}

function getAppUrl(): string {
  const appUrl = process.env.APP_URL || process.env.PUBLIC_URL;
  if (appUrl) return appUrl.replace(/\/+$/, "");
  return "http://localhost:3001";
}

/**
 * Creates a Mercado Pago Checkout Pro preference.
 */
export async function createPreference(
  options: CreatePreferenceOptions
): Promise<MPPreferenceResponse> {
  const accessToken = getAccessToken();
  const appUrl = getAppUrl();
  const externalReference = `usr_${options.userId}_${options.planTier}_${options.billingCycle}_${Date.now()}`;

  // If no token is configured, return sandbox/mock details so checkout can be tested
  if (!accessToken) {
    logger.warn("MERCADOPAGO_ACCESS_TOKEN not set in environment. Returning simulated checkout preference.");
    return {
      id: `pref_simulated_${Date.now()}`,
      init_point: `${appUrl}/checkout?simulated_success=true&ext_ref=${externalReference}&tier=${options.planTier}`,
      sandbox_init_point: `${appUrl}/checkout?simulated_success=true&ext_ref=${externalReference}&tier=${options.planTier}`,
      external_reference: externalReference,
    };
  }

  const payload = {
    items: [
      {
        id: `plan_${options.planTier}_${options.billingCycle}`,
        title: options.description || `Assinatura ${options.planTier.toUpperCase()} (${options.billingCycle === "yearly" ? "Anual" : "Mensal"})`,
        description: `Upgrade de plano no Ads Intelligence para ${options.planTier.toUpperCase()}`,
        quantity: 1,
        currency_id: "BRL",
        unit_price: Number(options.amount.toFixed(2)),
      },
    ],
    payer: {
      email: options.userEmail,
      name: options.userName || "Usuário Ads Intelligence",
    },
    back_urls: {
      success: `${appUrl}/checkout?payment_status=success`,
      failure: `${appUrl}/checkout?payment_status=failure`,
      pending: `${appUrl}/checkout?payment_status=pending`,
    },
    auto_return: "approved",
    external_reference: externalReference,
    notification_url: `${appUrl}/api/mercadopago/webhook`,
    statement_descriptor: "ADS INTELLIGENCE",
  };

  const response = await fetch(`${MP_BASE_URL}/checkout/preferences`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, body: errorText }, "Error creating Mercado Pago preference");
    throw new Error(`Mercado Pago API error: ${response.statusText}`);
  }

  const data = (await response.json()) as any;

  return {
    id: data.id,
    init_point: data.init_point,
    sandbox_init_point: data.sandbox_init_point || data.init_point,
    external_reference: externalReference,
  };
}

/**
 * Creates an instant Pix payment with Mercado Pago API.
 */
export async function createPixPayment(
  options: CreatePixOptions
): Promise<MPPixResponse> {
  const accessToken = getAccessToken();
  const appUrl = getAppUrl();
  const externalReference = `usr_${options.userId}_${options.planTier}_${options.billingCycle}_${Date.now()}`;

  // If no token is configured, return simulated Pix response for local testing
  if (!accessToken) {
    logger.warn("MERCADOPAGO_ACCESS_TOKEN not set. Returning simulated Pix QR Code.");
    const mockPaymentId = `pix_simulated_${Date.now()}`;
    const mockQrCode = `00020126580014br.gov.bcb.pix0136simulated-pix-key-${mockPaymentId}5204000053039865405${options.amount.toFixed(2)}5802BR5916ADSINTELLIGENCE6009SAOPAULO62070503***6304`;
    
    // SVG data uri placeholder QR code
    const mockQrCodeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    return {
      payment_id: mockPaymentId,
      status: "pending",
      status_detail: "pending_waiting_transfer",
      qr_code: mockQrCode,
      qr_code_base64: mockQrCodeBase64,
      external_reference: externalReference,
    };
  }

  const payload = {
    transaction_amount: Number(options.amount.toFixed(2)),
    description: options.description || `Assinatura ${options.planTier.toUpperCase()}`,
    payment_method_id: "pix",
    payer: {
      email: options.userEmail,
      first_name: options.userName || "Usuário",
    },
    external_reference: externalReference,
    notification_url: `${appUrl}/api/mercadopago/webhook`,
  };

  const response = await fetch(`${MP_BASE_URL}/v1/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Idempotency-Key": `pix_${options.userId}_${Date.now()}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, body: errorText }, "Error creating Mercado Pago Pix payment");
    throw new Error(`Mercado Pago Pix error: ${response.statusText}`);
  }

  const data = (await response.json()) as any;
  const poi = data.point_of_interaction?.transaction_data;

  return {
    payment_id: String(data.id),
    status: data.status,
    status_detail: data.status_detail,
    qr_code: poi?.qr_code || "",
    qr_code_base64: poi?.qr_code_base64 || "",
    ticket_url: poi?.ticket_url || "",
    external_reference: externalReference,
  };
}

/**
 * Fetches payment details from Mercado Pago REST API.
 */
export async function getPaymentDetails(paymentId: string): Promise<any> {
  const accessToken = getAccessToken();

  if (!accessToken || paymentId.startsWith("pix_simulated_") || paymentId.startsWith("pref_simulated_")) {
    return {
      id: paymentId,
      status: "approved",
      status_detail: "accredited",
      external_reference: paymentId,
      simulated: true,
    };
  }

  const response = await fetch(`${MP_BASE_URL}/v1/payments/${paymentId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, paymentId, errorText }, "Failed to fetch Mercado Pago payment details");
    throw new Error(`Failed to fetch payment details: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Verifies Mercado Pago webhook signature header (x-signature and x-request-id)
 * HMAC-SHA256 verification.
 */
export function verifyWebhookSignature(
  xSignatureHeader?: string,
  xRequestIdHeader?: string,
  dataId?: string
): boolean {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  
  // If secret is not set, allow processing (logged for security audit)
  if (!secret) {
    logger.warn("MERCADOPAGO_WEBHOOK_SECRET is not configured. Webhook signature verification bypassed.");
    return true;
  }

  if (!xSignatureHeader || !xRequestIdHeader || !dataId) {
    return false;
  }

  try {
    const parts = xSignatureHeader.split(",");
    let ts = "";
    let v1 = "";

    for (const part of parts) {
      const [key, value] = part.trim().split("=");
      if (key === "ts") ts = value;
      if (key === "v1") v1 = value;
    }

    if (!ts || !v1) return false;

    // Build signature template string according to Mercado Pago documentation:
    // id:<data.id>;request-id:<x-request-id>;ts:<ts>;
    const manifest = `id:${dataId};request-id:${xRequestIdHeader};ts:${ts};`;
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(manifest);
    const computedSignature = hmac.digest("hex");

    return crypto.timingSafeEqual(Buffer.from(computedSignature), Buffer.from(v1));
  } catch (err: any) {
    logger.error({ err: err.message }, "Error verifying webhook signature");
    return false;
  }
}
