// /api/tma.js — единый endpoint для Telegram Mini App
// HMAC проверка initData → admin check → actions для orders/AI

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

const HF_KEY_ID = process.env.HIGGSFIELD_KEY_ID;
const HF_KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;

/* -------- initData verification (Telegram WebApp HMAC) -------- */
function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  let params;
  try { params = new URLSearchParams(initData); } catch (e) { return null; }
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const pairs = [];
  params.forEach(function (v, k) { pairs.push(k + "=" + v); });
  pairs.sort();
  const dataCheckString = pairs.join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (calc !== hash) return null;
  // auth_date freshness (24h)
  const authDate = parseInt(params.get("auth_date") || "0", 10);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;
  // user
  let user = null;
  try { user = JSON.parse(params.get("user") || "{}"); } catch (e) { return null; }
  if (!user || !user.id) return null;
  return user;
}

async function isAdmin(tgUserId) {
  const envList = (process.env.TELEGRAM_ADMIN_IDS || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  if (envList.indexOf(String(tgUserId)) >= 0) return true;
  try {
    const r = await sb.from("tg_admins").select("telegram_user_id").eq("telegram_user_id", String(tgUserId)).maybeSingle();
    return !!(r && r.data);
  } catch (e) { return false; }
}

/* -------- Higgsfield helpers (sync submit + polling) -------- */
async function hfSubmit(prompt, ratio) {
  const r = await fetch("https://platform.higgsfield.ai/v1/text2image/flux-pro/kontext/max/text-to-image", {
    method: "POST",
    headers: {
      "hf-api-key": HF_KEY_ID,
      "hf-secret": HF_KEY_SECRET,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      params: { input_images: [], prompt: prompt, width_and_height: ratio || "1024x1024", enhance_prompt: false }
    })
  });
  const j = await r.json().catch(function () { return {}; });
  if (!r.ok) return { error: j.detail || j.message || ("status " + r.status) };
  return { jobSetId: j.id };
}

async function hfPoll(jobSetId) {
  const r = await fetch("https://platform.higgsfield.ai/v1/job-sets/" + jobSetId, {
    headers: { "hf-api-key": HF_KEY_ID, "hf-secret": HF_KEY_SECRET }
  });
  const j = await r.json().catch(function () { return {}; });
  if (!r.ok) return { error: j.detail || j.message || ("status " + r.status) };
  const job = (j.jobs || [])[0] || {};
  if (job.status === "completed" && job.results && job.results.raw && job.results.raw.url) {
    return { status: "completed", url: job.results.raw.url };
  }
  if (job.status === "failed" || job.status === "nsfw") return { status: "failed", error: job.error || job.status };
  return { status: "in_progress" };
}

/* -------- HTTP handler -------- */
export default async function (req, res) {
  // CORS for Telegram WebApp
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const initData = body.initData;
  const action = body.action;
  const payload = body.payload || {};

  // Verify Telegram signature
  const user = verifyInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
  if (!user) return res.status(401).json({ ok: false, error: "invalid_initdata" });

  // Admin check
  const admin = await isAdmin(user.id);
  if (!admin) return res.status(403).json({ ok: false, error: "not_admin", user_id: user.id });

  try {
    switch (action) {
      case "verify": {
        // Initial bootstrap: return user + KPI snapshot
        const ordersR = await sb.from("rfc_orders").select("id,status,total,created_at").order("created_at", { ascending: false });
        const productsR = await sb.from("rfc_products").select("id", { count: "exact", head: true });
        const orders = ordersR.data || [];
        const inProgressStatuses = ["Связались", "Оплачен", "Отправлен"];
        const kpi = {
          total: orders.length,
          fresh: orders.filter(function (o) { return o.status === "Новый"; }).length,
          inProgress: orders.filter(function (o) { return inProgressStatuses.indexOf(o.status) >= 0; }).length,
          revenue: orders.filter(function (o) { return o.status !== "Отменён"; }).reduce(function (a, o) { return a + (o.total || 0); }, 0),
          products: productsR.count || 0
        };
        return res.status(200).json({
          ok: true,
          user: { id: user.id, first_name: user.first_name || "", username: user.username || "" },
          kpi: kpi
        });
      }

      case "orders_list": {
        const r = await sb.from("rfc_orders").select("*").order("created_at", { ascending: false });
        if (r.error) return res.status(500).json({ ok: false, error: r.error.message });
        return res.status(200).json({ ok: true, orders: r.data || [] });
      }

      case "orders_update_status": {
        if (!payload.id || !payload.status) return res.status(400).json({ ok: false, error: "missing_fields" });
        const r = await sb.from("rfc_orders").update({ status: payload.status }).eq("id", payload.id);
        if (r.error) return res.status(500).json({ ok: false, error: r.error.message });
        return res.status(200).json({ ok: true });
      }

      case "orders_delete": {
        if (!payload.id) return res.status(400).json({ ok: false, error: "missing_id" });
        const r = await sb.from("rfc_orders").delete().eq("id", payload.id);
        if (r.error) return res.status(500).json({ ok: false, error: r.error.message });
        return res.status(200).json({ ok: true });
      }

      case "ai_submit": {
        if (!payload.prompt) return res.status(400).json({ ok: false, error: "no_prompt" });
        if (!HF_KEY_ID || !HF_KEY_SECRET) return res.status(500).json({ ok: false, error: "no_higgsfield_keys" });
        const ratio = payload.ratio || "1024x1024";
        const sub = await hfSubmit(payload.prompt, ratio);
        if (sub.error) return res.status(500).json({ ok: false, error: sub.error });
        // Лог в ai_generations
        try {
          await sb.from("ai_generations").insert({
            telegram_user_id: String(user.id),
            source: "tma",
            prompt: payload.prompt,
            job_set_id: sub.jobSetId,
            status: "in_progress"
          });
        } catch (e) {}
        return res.status(200).json({ ok: true, jobSetId: sub.jobSetId });
      }

      case "ai_poll": {
        if (!payload.jobSetId) return res.status(400).json({ ok: false, error: "no_job" });
        const p = await hfPoll(payload.jobSetId);
        if (p.error) return res.status(500).json({ ok: false, error: p.error });
        if (p.status === "completed") {
          try {
            await sb.from("ai_generations").update({ status: "completed", result_url: p.url }).eq("job_set_id", payload.jobSetId);
          } catch (e) {}
          return res.status(200).json({ ok: true, status: "completed", url: p.url });
        }
        if (p.status === "failed") {
          try {
            await sb.from("ai_generations").update({ status: "failed" }).eq("job_set_id", payload.jobSetId);
          } catch (e) {}
          return res.status(200).json({ ok: true, status: "failed", error: p.error });
        }
        return res.status(200).json({ ok: true, status: "in_progress" });
      }

      default:
        return res.status(400).json({ ok: false, error: "unknown_action" });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
