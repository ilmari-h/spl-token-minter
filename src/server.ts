import { z } from "zod/v4";
import { isAddress } from "@solana/kit";
import { mintTokens } from "./solana";

const MintBodySchema = z.object({
  amount: z.number().positive(),
});

const PORT = Number(process.env.PORT) || 3000;
const API_SECRET = process.env.API_SECRET;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authorize(req: Request): boolean {
  if (!API_SECRET) return false;
  const header = req.headers.get("Authorization");
  return header === `Bearer ${API_SECRET}`;
}

Bun.serve({
  port: PORT,
  routes: {
    "/health": new Response("OK"),
    "/mint/:recipient": {
      POST: async (req) => {
        if (!authorize(req)) {
          return jsonResponse({ success: false, error: "Unauthorized" }, 401);
        }

        const { recipient } = req.params;
        if (!isAddress(recipient)) {
          return jsonResponse(
            { success: false, error: "Invalid recipient address" },
            400,
          );
        }

        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return jsonResponse(
            { success: false, error: "Invalid JSON body" },
            400,
          );
        }

        const parsed = MintBodySchema.safeParse(body);
        if (!parsed.success) {
          return jsonResponse(
            { success: false, error: parsed.error.message },
            400,
          );
        }

        try {
          const signature = await mintTokens(recipient, parsed.data.amount);
          return jsonResponse({
            success: true,
            data: { signature, recipient, amount: parsed.data.amount },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Mint failed";
          return jsonResponse({ success: false, error: message }, 500);
        }
      },
    },
  },
  fetch(req) {
    return jsonResponse({ success: false, error: "Not found" }, 404);
  },
});

console.log(`Token minter API running on port ${PORT}`);
