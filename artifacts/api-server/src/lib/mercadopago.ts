import crypto from "crypto";
import { logger } from "./logger";

export interface CreatePreferenceOptions {
  userId: number;
  userEmail: string;
  userName?: string;
  planTier: "starter" | "pro" | "enterprise";
  billingCycle: "monthly" | "yearly";
  amount: number;
  description: string;
}

export interface CreatePixOptions {
  userId: number;
  userEmail: string;
  userName?: string;
  planTier: "starter" | "pro" | "enterprise";
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

export interface CreateCardPaymentOptions {
  userId: number;
  userEmail: string;
  userName?: string;
  planTier: "starter" | "pro" | "enterprise";
  billingCycle: "monthly" | "yearly";
  amount: number;
  token: string;
  paymentMethodId: string;
  issuerId?: string;
  installments: number;
  identificationType: string;
  identificationNumber: string;
}

function getAppUrl(): string | null {
  const appUrl = process.env.APP_URL || process.env.PUBLIC_URL;
  if (appUrl) return appUrl.replace(/\/+$/, "");
  return null;
}

function isValidReturnUrl(appUrl: string | null): appUrl is string {
  if (!appUrl) return false;
  try {
    const url = new URL(appUrl);
    return url.protocol === "https:" || (
      url.protocol === "http:" &&
      url.hostname !== "localhost" &&
      url.hostname !== "127.0.0.1" &&
      url.hostname !== "::1"
    );
  } catch {
    return false;
  }
}

export function getMercadoPagoConfiguration() {
  const appUrl = getAppUrl();
  const accessTokenConfigured = Boolean(getAccessToken());
  const returnUrlConfigured = isValidReturnUrl(appUrl);
  const publicKey = process.env.MERCADOPAGO_PUBLIC_KEY?.trim() || "";
  return {
    configured: accessTokenConfigured && Boolean(publicKey),
    accessTokenConfigured,
    publicKeyConfigured: Boolean(publicKey),
    publicKey,
    returnUrlConfigured,
    webhookConfigured: Boolean(process.env.MERCADOPAGO_WEBHOOK_SECRET),
  };
}

export async function createCardPayment(options: CreateCardPaymentOptions): Promise<any> {
  const accessToken = getAccessToken();
  if (!accessToken) throw new Error("MERCADOPAGO_ACCESS_TOKEN não está configurado no servidor");

  const externalReference = `usr_${options.userId}_${options.planTier}_${options.billingCycle}_${Date.now()}`;
  const payload = {
    transaction_amount: Number(options.amount.toFixed(2)),
    token: options.token,
    description: `Assinatura ${options.planTier.toUpperCase()} (${options.billingCycle === "yearly" ? "Anual" : "Mensal"})`,
    installments: options.installments,
    payment_method_id: options.paymentMethodId,
    ...(options.issuerId ? { issuer_id: options.issuerId } : {}),
    payer: {
      email: options.userEmail,
      first_name: options.userName || "Usuário",
      identification: {
        type: options.identificationType,
        number: options.identificationNumber,
      },
    },
    external_reference: externalReference,
  };

  const response = await fetch(`${MP_BASE_URL}/v1/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });

  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    logger.error({ status: response.status, cause: data?.cause }, "Error creating card payment");
    throw new Error(data?.message || "Não foi possível processar o cartão");
  }
  return data;
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

  if (!accessToken) {
    throw new Error("MERCADOPAGO_ACCESS_TOKEN não está configurado no servidor");
  }
  if (!isValidReturnUrl(appUrl)) {
    throw new Error("APP_URL deve usar um IP de desenvolvimento ou domínio HTTPS válido para o retorno do Mercado Pago");
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
      success: `${appUrl}/checkout?payment_status=success&plan=${options.planTier}&cycle=${options.billingCycle}`,
      failure: `${appUrl}/checkout?payment_status=failure&plan=${options.planTier}&cycle=${options.billingCycle}`,
      pending: `${appUrl}/checkout?payment_status=pending&plan=${options.planTier}&cycle=${options.billingCycle}`,
    },
    auto_return: "approved",
    external_reference: externalReference,
    ...(appUrl.startsWith("https://") && process.env.MERCADOPAGO_WEBHOOK_SECRET
      ? { notification_url: `${appUrl}/api/mercadopago/webhook` }
      : {}),
    statement_descriptor: "ADS INTELLIGENCE",
  };

  const response = await fetch(`${MP_BASE_URL}/checkout/preferences`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Idempotency-Key": `preference_${options.userId}_${Date.now()}`,
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

  if (!accessToken) {
    throw new Error("MERCADOPAGO_ACCESS_TOKEN não está configurado no servidor");
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
    ...(appUrl?.startsWith("https://") && process.env.MERCADOPAGO_WEBHOOK_SECRET
      ? { notification_url: `${appUrl}/api/mercadopago/webhook` }
      : {}),
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
    let providerMessage = response.statusText;
    try {
      const errorBody = JSON.parse(errorText);
      providerMessage = errorBody.message
        || errorBody.error
        || errorBody.cause?.map((cause: any) => cause.description || cause.code).filter(Boolean).join("; ")
        || providerMessage;
    } catch (_) {
      if (errorText.trim()) providerMessage = errorText.slice(0, 240);
    }
    if (providerMessage.toLowerCase().includes("collector user without key enabled")) {
      providerMessage = "A conta de recebimento ainda não possui uma chave Pix ativa. Cadastre uma chave Pix na conta antes de gerar o QR Code.";
    }
    throw new Error(`Pagamento Pix recusado: ${providerMessage}`);
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

  if (!accessToken) {
    throw new Error("MERCADOPAGO_ACCESS_TOKEN não está configurado no servidor");
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
  
  if (!secret) {
    logger.error("MERCADOPAGO_WEBHOOK_SECRET is not configured. Webhook rejected.");
    return false;
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
