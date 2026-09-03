// Shared in-memory Stripe fake for the billing unit tests (bootstrap,
// checkout route). Implements exactly the subset of the Stripe API the engine
// calls: products.list/create, prices.list/create, customers.create, and
// checkout.sessions.create. Records call counts so tests can assert
// idempotency ("did NOT call create"). No network, no secrets.
//
// The instance's .asStripe() casts it to the SDK's Stripe type for injection
// into the modules under test.

import Stripe from "stripe";
import { randomUUID } from "node:crypto";

export interface FakeProduct {
  id: string;
  name: string;
  active: boolean;
  metadata: Record<string, string>;
}

export interface FakePrice {
  id: string;
  product: string;
  active: boolean;
  unit_amount: number | null;
  currency: string;
  recurring: { interval: string } | null;
}

export class FakeStripe {
  products: FakeProduct[] = [];
  prices: FakePrice[] = [];
  customersCreated: Array<{ id: string; metadata: Record<string, string> }> = [];
  sessionsCreated: Array<Record<string, unknown>> = [];
  subscriptionsCanceled: string[] = [];

  productCreateCalls = 0;
  priceCreateCalls = 0;
  customerCreateCalls = 0;
  sessionCreateCalls = 0;
  subscriptionCancelCalls = 0;

  private nextProduct = 1;
  private nextPrice = 1;
  private nextSession = 1;

  /** Seeds an existing product (tagged `notary_tier`) + a monthly price at `unitAmountCents`. */
  seedProduct(tier: string, unitAmountCents: number): { productId: string; priceId: string } {
    const product: FakeProduct = {
      id: `prod_seeded_${tier}`,
      name: tier,
      active: true,
      metadata: { notary_tier: tier },
    };
    this.products.push(product);
    const price: FakePrice = {
      id: `price_seeded_${tier}`,
      product: product.id,
      active: true,
      unit_amount: unitAmountCents,
      currency: "usd",
      recurring: { interval: "month" },
    };
    this.prices.push(price);
    return { productId: product.id, priceId: price.id };
  }

  productsApi = {
    list: async (params: { active?: boolean; limit?: number }): Promise<{ data: FakeProduct[]; has_more: boolean }> => {
      const filtered = this.products.filter((p) => p.active === (params.active ?? true));
      return { data: filtered.slice(0, params.limit ?? 100), has_more: false };
    },
    create: async (params: { name: string; metadata?: Record<string, string> }): Promise<FakeProduct> => {
      this.productCreateCalls += 1;
      const product: FakeProduct = {
        id: `prod_${this.nextProduct++}`,
        name: params.name,
        active: true,
        metadata: params.metadata ?? {},
      };
      this.products.push(product);
      return product;
    },
  };

  pricesApi = {
    list: async (params: { product: string; active?: boolean; limit?: number }): Promise<{ data: FakePrice[]; has_more: boolean }> => {
      const filtered = this.prices.filter((p) => p.product === params.product && p.active === (params.active ?? true));
      return { data: filtered.slice(0, params.limit ?? 100), has_more: false };
    },
    create: async (params: {
      product: string;
      unit_amount: number;
      currency: string;
      recurring: { interval: string };
    }): Promise<FakePrice> => {
      this.priceCreateCalls += 1;
      const price: FakePrice = {
        id: `price_${this.nextPrice++}`,
        product: params.product,
        active: true,
        unit_amount: params.unit_amount,
        currency: params.currency,
        recurring: params.recurring,
      };
      this.prices.push(price);
      return price;
    },
  };

  customersApi = {
    create: async (params: { metadata?: Record<string, string> }): Promise<{ id: string; metadata: Record<string, string> }> => {
      this.customerCreateCalls += 1;
      // Globally-unique id: the engine persists customer ids on the
      // organization row, which has a unique-when-present constraint, and the
      // test database is shared across tests and re-runs.
      const customer = { id: `cus_${randomUUID().replace(/-/g, "")}`, metadata: params.metadata ?? {} };
      this.customersCreated.push(customer);
      return customer;
    },
  };

  checkoutApi = {
    sessions: {
      create: async (params: Record<string, unknown>): Promise<{ id: string; url: string }> => {
        this.sessionCreateCalls += 1;
        const session = {
          id: `cs_test_${this.nextSession++}`,
          url: `https://checkout.stripe.com/c/pay/test_${this.nextSession - 1}`,
          ...params,
        };
        this.sessionsCreated.push(session);
        return session;
      },
    },
  };

  subscriptionsApi = {
    cancel: async (id: string): Promise<{ id: string; status: string }> => {
      this.subscriptionCancelCalls += 1;
      this.subscriptionsCanceled.push(id);
      return { id, status: "canceled" };
    },
  };

  /** Casts the fake to the SDK's Stripe type for injection. */
  asStripe(): Stripe {
    return {
      products: this.productsApi,
      prices: this.pricesApi,
      customers: this.customersApi,
      checkout: this.checkoutApi,
      subscriptions: this.subscriptionsApi,
    } as unknown as Stripe;
  }
}
