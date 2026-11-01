const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  Module = require("node:module");
const original = Module._load,
  calls = [];
Module._load = function (name, parent, main) {
  if (name === "stripe")
    return class {
      constructor() {
        this.paymentIntents = {
          create: async (params, options) => {
            calls.push({ params, options });
            return { ...params, id: "pi_synthetic", status: "succeeded" };
          },
        };
      }
    };
  if (name === "../../config" && parent.filename.endsWith("stripe.ts"))
    return {
      __esModule: true,
      default: { stripe: { stripe_secret_key: "synthetic-no-provider" } },
    };
  return original.call(this, name, parent, main);
};
const helper = require("../src/helpars/stripe/stripe");
Module._load = original;
test("wallet helper sends explicit local currency, correct minor units, metadata and provider idempotency", async () => {
  await helper.createWalletPaymentIntent({
    amount: 50.25,
    currency: "egp",
    paymentMethodId: "pm_synthetic",
    idempotencyKey: "synthetic-key",
    ledgerId: "synthetic-ledger:credit",
    userId: "synthetic-patient",
  });
  const call = calls.at(-1);
  assert.equal(call.params.currency, "egp");
  assert.equal(call.params.amount, 5025);
  assert.equal(call.options.idempotencyKey, "synthetic-key");
  assert.equal(call.params.metadata.walletLedgerId, "synthetic-ledger:credit");
});
test("existing explicitly USD-priced subscription helper remains in USD", async () => {
  await helper.createPaymentIntent(5, "pm_subscription");
  assert.equal(calls.at(-1).params.currency, "usd");
  assert.equal(calls.at(-1).params.amount, 500);
});
