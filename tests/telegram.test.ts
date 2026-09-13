import assert from "node:assert/strict";
import { sendTelegramMessage } from "../lib/server/telegram.ts";

const requests: Array<{ url: string; init?: RequestInit }> = [];
const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
  requests.push({ url: String(input), init });
  return new Response("ignored", { status: 200 });
}) as typeof fetch;

const result = await sendTelegramMessage("hello <b>world</b>", {
  botToken: "fake-token",
  chatId: "fake-chat",
  fetchImpl,
});
assert.equal(result.sent, true);
assert.equal(requests.length, 1);
assert.equal(requests[0]?.url, "https://api.telegram.org/botfake-token/sendMessage");
assert.equal(requests[0]?.init?.method, "POST");
assert.equal(requests[0]?.init?.body instanceof FormData, true);
const body = requests[0]?.init?.body as FormData;
assert.equal(body.get("chat_id"), "fake-chat");
assert.equal(body.get("text"), "hello <b>world</b>");
assert.equal(body.get("parse_mode"), "HTML");

const missing = await sendTelegramMessage("test", {});
assert.deepEqual(missing, { sent: false, errorCode: "TELEGRAM_UNAVAILABLE" });

const failed = await sendTelegramMessage("test", {
  botToken: "fake-token",
  chatId: "fake-chat",
  fetchImpl: (async () => new Response("raw telegram error", { status: 500 })) as typeof fetch,
});
assert.deepEqual(failed, { sent: false, errorCode: "TELEGRAM_SEND_FAILED" });
assert.equal(JSON.stringify(failed).includes("raw telegram error"), false);

const thrown = await sendTelegramMessage("test", {
  botToken: "fake-token",
  chatId: "fake-chat",
  fetchImpl: (async () => { throw new Error("secret network detail"); }) as typeof fetch,
});
assert.deepEqual(thrown, { sent: false, errorCode: "TELEGRAM_SEND_FAILED" });
assert.equal(JSON.stringify(thrown).includes("secret network detail"), false);

console.log("telegram.test: PASS");
