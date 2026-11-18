export type GatewayProvider = 'UPI Gateway';

export type PaymentStatus = 'CONFIRMED' | 'PENDING' | 'FAILED';

export type PaymentMethod = 'UPI QR' | 'UPI Intent';

export interface PaymentTransaction {
  id: string;
  orderId: string;
  payerName: string;
  payerPhone?: string;
  paymentSource: string;
  amount: number;
  currency: 'INR';
  status: PaymentStatus;
  gateway: GatewayProvider;
  method: PaymentMethod;
  utr: string;
  note: string;
  vpa: string;
  createdAt: string;
  confirmedAt?: string;
}

export interface GatewayConfig {
  provider: GatewayProvider;
  merchantName: string;
  merchantVpa: string;
  keyId: string;
  webhookActive: boolean;
  soundboxEnabled: boolean;
  vibrationEnabled: boolean;
  voiceLanguage: 'en-IN' | 'hi-IN';
}

export interface CreateOrderResponse {
  transaction: PaymentTransaction;
  upiUri: string;
  checkoutUrl: string;
}
