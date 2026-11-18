import 'dotenv/config';
import {GoogleGenAI, ThinkingLevel, Type} from '@google/genai';
import express, {type Request, type Response} from 'express';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import type {GatewayConfig, GatewayProvider, PaymentMethod, PaymentTransaction} from './src/types/payment.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(__dirname, '.data');
const DATA_FILE = path.join(DATA_DIR, 'confirm-pro.json');

interface StoreState {
  config: GatewayConfig;
  transactions: PaymentTransaction[];
}

function generateUtr(): string {
  const prefix = '4322';
  const rest = Math.floor(10000000 + Math.random() * 89999999).toString();
  return `${prefix}${rest}`;
}

function generateOrderId(): string {
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const rand = Math.floor(100 + Math.random() * 900);
  return `ORD-${stamp}${rand}`;
}

function generateTxnId(): string {
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `CP-${rand}`;
}

function formatIndianPhone(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length >= 10 ? digits.slice(-10) : '';
  if (/^[6-9]\d{9}$/.test(ten)) {
    return `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`;
  }
  return undefined;
}

function inferPhoneFromVpa(vpa?: string | null): string | undefined {
  if (!vpa) return undefined;
  const local = vpa.split('@')[0] || '';
  const match = local.match(/^([6-9]\d{9})/);
  return match ? formatIndianPhone(match[1]) : undefined;
}

function inferPaymentSource(
  vpa?: string | null,
  method?: PaymentMethod,
  _gateway?: GatewayProvider,
  explicitSource?: string | null
): string {
  if (explicitSource && explicitSource.trim()) return explicitSource.trim();
  const handle = (vpa || '').toLowerCase().split('@')[1] || '';
  if (['ybl', 'ibl', 'axl'].includes(handle)) return 'PhonePe UPI';
  if (['okicici', 'okaxis', 'okhdfcbank', 'oksbi'].includes(handle)) return 'Google Pay';
  if (['paytm', 'ptsbi', 'pthdfc', 'ptaxis'].includes(handle)) return 'Paytm UPI';
  if (handle === 'upi') return 'BHIM UPI';
  if (['apl', 'rapl'].includes(handle)) return 'Amazon Pay UPI';
  if (handle === 'slice') return 'Slice UPI';
  return `UPI Gateway · ${method || 'UPI QR'}`;
}

function extractGatewayCustomerFields(body: Record<string, unknown>): {
  payerName?: string;
  payerPhone?: string;
  payerVpa?: string;
  paymentSource?: string;
  amount?: number;
  orderId?: string;
  note?: string;
  method?: PaymentMethod;
  gateway?: GatewayProvider;
} {
  // Support Razorpay webhook payload: payload.payment.entity
  const payload = body.payload as Record<string, unknown> | undefined;
  const rzpEntity = (payload?.payment as Record<string, unknown> | undefined)?.entity as
    | Record<string, unknown>
    | undefined;

  // Support Cashfree webhook payload: data.customer_details / data.payment
  const cfData = body.data as Record<string, unknown> | undefined;
  const cfCustomer = cfData?.customer_details as Record<string, unknown> | undefined;
  const cfPayment = cfData?.payment as Record<string, unknown> | undefined;

  const rawVpa =
    (typeof body.payerVpa === 'string' && body.payerVpa) ||
    (typeof body.vpa === 'string' && body.vpa) ||
    (typeof rzpEntity?.vpa === 'string' && rzpEntity.vpa) ||
    (typeof (cfPayment?.payment_method as Record<string, unknown> | undefined)?.upi === 'object' &&
      String(
        ((cfPayment?.payment_method as Record<string, unknown>).upi as Record<string, unknown>).upi_id || ''
      )) ||
    undefined;

  const rawPhone =
    (typeof body.payerPhone === 'string' && body.payerPhone) ||
    (typeof body.customerPhone === 'string' && body.customerPhone) ||
    (typeof body.contact === 'string' && body.contact) ||
    (typeof rzpEntity?.contact === 'string' && rzpEntity.contact) ||
    (typeof cfCustomer?.customer_phone === 'string' && cfCustomer.customer_phone) ||
    undefined;

  const rawName =
    (typeof body.payerName === 'string' && body.payerName) ||
    (typeof body.customerName === 'string' && body.customerName) ||
    (typeof rzpEntity?.notes === 'object' &&
      rzpEntity.notes !== null &&
      typeof (rzpEntity.notes as Record<string, unknown>).customer_name === 'string' &&
      String((rzpEntity.notes as Record<string, unknown>).customer_name)) ||
    (typeof cfCustomer?.customer_name === 'string' && cfCustomer.customer_name) ||
    undefined;

  const rawAmount =
    typeof body.amount === 'number'
      ? body.amount
      : typeof rzpEntity?.amount === 'number'
        ? rzpEntity.amount / 100
        : typeof cfPayment?.payment_amount === 'number'
          ? cfPayment.payment_amount
          : undefined;

  const payerPhone = formatIndianPhone(rawPhone) || inferPhoneFromVpa(rawVpa);
  const method: PaymentMethod = body.method === 'UPI Intent' ? 'UPI Intent' : 'UPI QR';
  const gateway: GatewayProvider = 'UPI Gateway';

  return {
    payerName: rawName?.trim() || undefined,
    payerPhone,
    payerVpa: rawVpa?.trim() || undefined,
    paymentSource: inferPaymentSource(
      rawVpa,
      method,
      gateway,
      typeof body.paymentSource === 'string' ? body.paymentSource : undefined
    ),
    amount: rawAmount,
    orderId:
      (typeof body.orderId === 'string' && body.orderId) ||
      (typeof rzpEntity?.order_id === 'string' && rzpEntity.order_id) ||
      (typeof (cfData?.order as Record<string, unknown> | undefined)?.order_id === 'string' &&
        String((cfData?.order as Record<string, unknown>).order_id)) ||
      undefined,
    note: typeof body.note === 'string' ? body.note : undefined,
    method,
    gateway,
  };
}

function createInitialState(): StoreState {
  const now = Date.now();
  return {
    config: {
      provider: 'UPI Gateway',
      merchantName: 'Payment QR Merchant',
      merchantVpa: 'paymentqr@okaxis',
      keyId: 'cp_live_9842a10e4c',
      webhookActive: true,
      soundboxEnabled: true,
      vibrationEnabled: true,
      voiceLanguage: 'en-IN',
    },
    transactions: [
      {
        id: 'CP-847210',
        orderId: 'ORD-9K2104',
        payerName: 'Jeanet Fernandes',
        payerPhone: '+91 98204 51290',
        paymentSource: 'Google Pay',
        amount: 270,
        currency: 'INR',
        status: 'CONFIRMED',
        gateway: 'UPI Gateway',
        method: 'UPI QR',
        utr: '432281904112',
        note: 'Auto-captured via UPI Gateway',
        vpa: 'jeanet.f@okicici',
        createdAt: new Date(now - 8 * 60 * 1000).toISOString(),
        confirmedAt: new Date(now - 8 * 60 * 1000).toISOString(),
      },
      {
        id: 'CP-847195',
        orderId: 'ORD-9K2088',
        payerName: 'Rohan Kulkarni',
        payerPhone: '+91 97654 31082',
        paymentSource: 'PhonePe UPI',
        amount: 850,
        currency: 'INR',
        status: 'CONFIRMED',
        gateway: 'UPI Gateway',
        method: 'UPI Intent',
        utr: '432281903845',
        note: 'Auto-captured via UPI Gateway',
        vpa: '9765431082@ybl',
        createdAt: new Date(now - 34 * 60 * 1000).toISOString(),
        confirmedAt: new Date(now - 34 * 60 * 1000).toISOString(),
      },
      {
        id: 'CP-847162',
        orderId: 'ORD-9K2041',
        payerName: 'Ananya Traders',
        payerPhone: '+91 98192 77401',
        paymentSource: 'Paytm UPI',
        amount: 1450,
        currency: 'INR',
        status: 'CONFIRMED',
        gateway: 'UPI Gateway',
        method: 'UPI QR',
        utr: '432281902219',
        note: 'Auto-captured via UPI Gateway',
        vpa: '9819277401@paytm',
        createdAt: new Date(now - 95 * 60 * 1000).toISOString(),
        confirmedAt: new Date(now - 95 * 60 * 1000).toISOString(),
      },
    ],
  };
}

function loadState(): StoreState {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as StoreState;
      if (parsed && parsed.config && Array.isArray(parsed.transactions)) {
        return parsed;
      }
    }
  } catch {
    // Fallback to initial state if persistence file is unreadable
  }
  return createInitialState();
}

function saveState(state: StoreState): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, {recursive: true});
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // Continue safely in read-only environments
  }
}

const state = loadState();
const sseClients = new Set<Response>();

function broadcastPaymentConfirmed(tx: PaymentTransaction): void {
  const payload = `event: payment_confirmed\ndata: ${JSON.stringify(tx)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function buildUpiUri(tx: PaymentTransaction, config: GatewayConfig): string {
  const params = new URLSearchParams({
    pa: config.merchantVpa,
    pn: config.merchantName,
    am: tx.amount.toFixed(2),
    cu: 'INR',
    tr: tx.orderId,
    tn: tx.note || `Payment QR ${tx.orderId}`,
  });
  return `upi://pay?${params.toString()}`;
}

async function startServer() {
  const app = express();
  app.use(express.json({limit: '10mb'}));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({status: 'ok', service: 'Payment QR Gateway'});
  });

  app.get('/api/gateway/config', (_req: Request, res: Response) => {
    res.json(state.config);
  });

  app.post('/api/gateway/config', (req: Request, res: Response) => {
    const body = req.body as Partial<GatewayConfig>;
    state.config = {
      ...state.config,
      provider: 'UPI Gateway',
      merchantName: (body.merchantName ?? state.config.merchantName).trim() || 'Payment QR Merchant',
      merchantVpa: (body.merchantVpa ?? state.config.merchantVpa).trim() || 'paymentqr@okaxis',
      keyId: (body.keyId ?? state.config.keyId).trim() || state.config.keyId,
      webhookActive: typeof body.webhookActive === 'boolean' ? body.webhookActive : state.config.webhookActive,
      soundboxEnabled: typeof body.soundboxEnabled === 'boolean' ? body.soundboxEnabled : state.config.soundboxEnabled,
      vibrationEnabled: typeof body.vibrationEnabled === 'boolean' ? body.vibrationEnabled : state.config.vibrationEnabled,
      voiceLanguage: body.voiceLanguage === 'hi-IN' ? 'hi-IN' : 'en-IN',
    };
    saveState(state);
    res.json(state.config);
  });

  app.get('/api/payments', (_req: Request, res: Response) => {
    const confirmed = state.transactions.filter((t) => t.status === 'CONFIRMED');
    const totalCollected = confirmed.reduce((sum, t) => sum + t.amount, 0);
    res.json({
      transactions: state.transactions,
      stats: {
        totalCollected,
        confirmedCount: confirmed.length,
        pendingCount: state.transactions.filter((t) => t.status === 'PENDING').length,
      },
    });
  });

  app.get('/api/payments/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`event: connected\ndata: ${JSON.stringify({connected: true})}\n\n`);
    sseClients.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  app.get('/api/payments/:id', (req: Request, res: Response) => {
    const {id} = req.params;
    const tx = state.transactions.find((t) => t.id === id || t.orderId === id);
    if (!tx) {
      res.status(404).json({error: 'Order not found'});
      return;
    }
    res.json({
      transaction: tx,
      config: state.config,
      upiUri: buildUpiUri(tx, state.config),
    });
  });

  app.post('/api/payments/create', (req: Request, res: Response) => {
    const {amount, payerName, note, gateway, method} = req.body as {
      amount?: number;
      payerName?: string;
      note?: string;
      gateway?: GatewayProvider;
      method?: PaymentMethod;
    };

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      res.status(400).json({error: 'Valid payment amount greater than 0 is required'});
      return;
    }

    const orderId = generateOrderId();
    const tx: PaymentTransaction = {
      id: generateTxnId(),
      orderId,
      payerName: (payerName || '').trim() || 'Awaiting Customer',
      paymentSource: `${gateway || state.config.provider} · ${method || 'UPI QR'}`,
      amount: Math.round(numericAmount * 100) / 100,
      currency: 'INR',
      status: 'PENDING',
      gateway: gateway || state.config.provider,
      method: method || 'UPI QR',
      utr: 'PENDING',
      note: (note || '').trim() || 'QR Payment Request',
      vpa: state.config.merchantVpa,
      createdAt: new Date().toISOString(),
    };

    state.transactions.unshift(tx);
    if (state.transactions.length > 100) {
      state.transactions = state.transactions.slice(0, 100);
    }
    saveState(state);

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.get('host') || `localhost:${PORT}`;
    const checkoutUrl = `${protocol}://${host}/?checkout=${encodeURIComponent(tx.orderId)}`;

    res.status(201).json({
      transaction: tx,
      upiUri: buildUpiUri(tx, state.config),
      checkoutUrl,
    });
  });

  app.post('/api/payments/verify', (req: Request, res: Response) => {
    const extracted = extractGatewayCustomerFields(req.body as Record<string, unknown>);
    const {orderId, amount, payerName, payerPhone, payerVpa, paymentSource, note, gateway, method} = {
      ...extracted,
      ...(req.body as {
        orderId?: string;
        amount?: number;
        payerName?: string;
        payerPhone?: string;
        payerVpa?: string;
        paymentSource?: string;
        note?: string;
        gateway?: GatewayProvider;
        method?: PaymentMethod;
      }),
    };

    const resolvedPhone = formatIndianPhone(payerPhone) || inferPhoneFromVpa(payerVpa) || extracted.payerPhone;
    const resolvedGateway = gateway || extracted.gateway || state.config.provider;
    const resolvedMethod = method || extracted.method || 'UPI QR';
    const resolvedSource = inferPaymentSource(payerVpa, resolvedMethod, resolvedGateway, paymentSource);

    let tx: PaymentTransaction | undefined;
    if (orderId) {
      tx = state.transactions.find((t) => t.orderId === orderId || t.id === orderId);
    }

    const nowIso = new Date().toISOString();

    if (tx) {
      tx.status = 'CONFIRMED';
      tx.utr = tx.utr && tx.utr !== 'PENDING' ? tx.utr : generateUtr();
      tx.confirmedAt = nowIso;
      if (payerName?.trim()) tx.payerName = payerName.trim();
      else if (tx.payerName === 'Awaiting Customer' || tx.payerName === 'Walk-in Customer') {
        tx.payerName = 'UPI Customer';
      }
      if (resolvedPhone) tx.payerPhone = resolvedPhone;
      if (payerVpa?.trim()) tx.vpa = payerVpa.trim();
      tx.paymentSource = resolvedSource;
      tx.method = resolvedMethod;
      tx.gateway = resolvedGateway;
    } else {
      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        res.status(400).json({error: 'Valid payment amount greater than 0 is required'});
        return;
      }

      tx = {
        id: generateTxnId(),
        orderId: orderId || generateOrderId(),
        payerName: (payerName || '').trim() || 'UPI Customer',
        payerPhone: resolvedPhone,
        paymentSource: resolvedSource,
        amount: Math.round(numericAmount * 100) / 100,
        currency: 'INR',
        status: 'CONFIRMED',
        gateway: resolvedGateway,
        method: resolvedMethod,
        utr: generateUtr(),
        note: (note || '').trim() || `Captured via ${resolvedSource}`,
        vpa: payerVpa?.trim() || state.config.merchantVpa,
        createdAt: nowIso,
        confirmedAt: nowIso,
      };
      state.transactions.unshift(tx);
    }

    if (state.transactions.length > 100) {
      state.transactions = state.transactions.slice(0, 100);
    }
    saveState(state);
    broadcastPaymentConfirmed(tx);

    res.json({
      verified: true,
      transaction: tx,
    });
  });

  app.post('/api/payments/webhook', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const event = typeof body.event === 'string' ? body.event : undefined;

    if (event && event !== 'payment.captured' && event !== 'PAYMENT_SUCCESS_WEBHOOK') {
      res.json({received: true, ignored: true});
      return;
    }

    const extracted = extractGatewayCustomerFields(body);
    const numericAmount = Number(extracted.amount) || 270;
    const nowIso = new Date().toISOString();
    const resolvedGateway = extracted.gateway || state.config.provider;
    const resolvedMethod = extracted.method || 'UPI Intent';
    const resolvedVpa = extracted.payerVpa || state.config.merchantVpa;
    const resolvedSource = extracted.paymentSource || inferPaymentSource(resolvedVpa, resolvedMethod, resolvedGateway);

    const tx: PaymentTransaction = {
      id: generateTxnId(),
      orderId: extracted.orderId || generateOrderId(),
      payerName: extracted.payerName || 'Gateway Customer',
      payerPhone: extracted.payerPhone,
      paymentSource: resolvedSource,
      amount: Math.round(numericAmount * 100) / 100,
      currency: 'INR',
      status: 'CONFIRMED',
      gateway: resolvedGateway,
      method: resolvedMethod,
      utr: generateUtr(),
      note: extracted.note || `Auto-captured via ${resolvedSource}`,
      vpa: resolvedVpa,
      createdAt: nowIso,
      confirmedAt: nowIso,
    };

    state.transactions.unshift(tx);
    if (state.transactions.length > 100) {
      state.transactions = state.transactions.slice(0, 100);
    }
    saveState(state);
    broadcastPaymentConfirmed(tx);

    res.json({received: true, transaction: tx});
  });

  app.post('/api/payments/scan-image', async (req: Request, res: Response) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({error: 'GEMINI_API_KEY is not configured in server secrets.'});
      return;
    }

    const {imageBase64, mimeType} = req.body as {imageBase64?: string; mimeType?: string};
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({error: 'Image data is required for amount scanning.'});
      return;
    }

    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
    const safeMimeType = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const modelsToTry: Array<{model: string; level: ThinkingLevel}> = [
        {model: 'gemini-4-hydrogen', level: ThinkingLevel.LOW},
        {model: 'gemini-3.1-flash-lite', level: ThinkingLevel.MINIMAL},
      ];

      let responseText = '';
      let lastError: unknown = null;

      for (const candidate of modelsToTry) {
        try {
          const response = await ai.models.generateContent({
            model: candidate.model,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: safeMimeType,
                    data: cleanBase64,
                  },
                },
                {
                  text: 'Extract ONLY the primary collectible payment amount shown on this screen, plus any visible customer name, mobile number, UPI ID, or payment app source. Ignore secondary amounts such as wallet additions, + or - adjustments, fees, percentages, or clock time. Do not add or subtract anything.',
                },
              ],
            },
            config: {
              thinkingConfig: {thinkingLevel: candidate.level},
              systemInstruction:
                'You are a precision payment amount and customer detail scanner. Your primary job is to read the single primary collectible/due payment amount (for example, the large bold figure under "Collect payment" or "<Name> owes ₹259.94"). STRICT RULES: (1) Return ONLY that exact primary amount verbatim including exact decimal paise (e.g. 259.94). (2) NEVER add, subtract, multiply, or round any numbers. (3) COMPLETELY IGNORE secondary amounts such as "+₹1.27 added to Wallet", cashback, wallet balances, discounts, tip amounts, battery percentage, or time. (4) Automatically extract customer details if clearly visible on screen: payerName (e.g. "Amar" from "Amar owes"), payerPhone (10-digit mobile number if shown), payerVpa (UPI ID like name@okaxis if shown), and paymentSource (app/bank like PhonePe, Google Pay, Paytm if shown). Return null for any field not visible.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  found: {
                    type: Type.BOOLEAN,
                    description: 'True if a clear primary collectible payment amount is visible.',
                  },
                  primaryAmount: {
                    type: Type.NUMBER,
                    description: 'The exact primary collectible amount without adding or subtracting any other number.',
                    nullable: true,
                  },
                  payerName: {
                    type: Type.STRING,
                    description: 'Customer name if displayed (e.g. Amar from "Amar owes").',
                    nullable: true,
                  },
                  payerPhone: {
                    type: Type.STRING,
                    description: 'Customer mobile number if displayed on screen.',
                    nullable: true,
                  },
                  payerVpa: {
                    type: Type.STRING,
                    description: 'Customer UPI ID if displayed on screen.',
                    nullable: true,
                  },
                  paymentSource: {
                    type: Type.STRING,
                    description: 'Payment app or bank source if displayed on screen.',
                    nullable: true,
                  },
                  matchedText: {
                    type: Type.STRING,
                    description: 'The exact currency text read for the primary amount (e.g. "₹259.94").',
                    nullable: true,
                  },
                },
                required: ['found'],
              },
            },
          });
          responseText = (response.text ?? '{}').trim();
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          const msg = err instanceof Error ? err.message : String(err);
          const isTransient = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('429');
          if (!isTransient) {
            throw err;
          }
          await new Promise((r) => setTimeout(r, 350));
        }
      }

      if (lastError) {
        throw lastError;
      }

      const rawJson = responseText || '{}';
      const parsed = JSON.parse(rawJson) as {
        found?: boolean;
        primaryAmount?: number | null;
        payerName?: string | null;
        payerPhone?: string | null;
        payerVpa?: string | null;
        paymentSource?: string | null;
        matchedText?: string | null;
      };

      if (!parsed.found || typeof parsed.primaryAmount !== 'number' || !Number.isFinite(parsed.primaryAmount) || parsed.primaryAmount <= 0) {
        res.status(422).json({
          error: 'Could not detect a clear primary payment amount in the image.',
          found: false,
        });
        return;
      }

      const exactAmount = Math.round(parsed.primaryAmount * 100) / 100;
      const formattedPhone = formatIndianPhone(parsed.payerPhone) || inferPhoneFromVpa(parsed.payerVpa);
      res.json({
        found: true,
        primaryAmount: exactAmount,
        payerName: parsed.payerName ? parsed.payerName.trim() : null,
        payerPhone: formattedPhone || null,
        payerVpa: parsed.payerVpa ? parsed.payerVpa.trim() : null,
        paymentSource: parsed.paymentSource ? parsed.paymentSource.trim() : null,
        matchedText: parsed.matchedText || `₹${exactAmount.toFixed(2)}`,
      });
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Failed to scan amount from image';
      const cleanMsg = rawMsg.includes('503') || rawMsg.includes('UNAVAILABLE')
        ? 'Scanner service is momentarily busy. Please tap Scan again.'
        : rawMsg;
      res.status(502).json({error: cleanMsg});
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Payment QR server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
