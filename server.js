import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import cron from "node-cron";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

// ─── Validate env vars ────────────────────────────────────
const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "RESEND_API_KEY"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌  Missing env var: ${key}`);
    process.exit(1);
  }
}

// ─── Clients ──────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());

// ─── Serve static files from root folder ──────────────────
app.use(express.static(__dirname));

// ─── Root route → index.html ──────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ─── POST /api/letters ────────────────────────────────────
app.post("/api/letters", async (req, res) => {
  try {
    const { letter, email, delivery_date } = req.body;

    if (!letter || typeof letter !== "string" || letter.trim().length < 20) {
      return res.status(400).json({ error: "Letter is too short." });
    }
    if (letter.trim().length > 10000) {
      return res.status(400).json({ error: "Letter exceeds 10,000 characters." });
    }

    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRx.test(email)) {
      return res.status(400).json({ error: "Invalid email address." });
    }

    if (!delivery_date) {
      return res.status(400).json({ error: "Delivery date is required." });
    }

    const chosen = new Date(delivery_date + "T00:00:00");
    const today  = new Date();
    today.setHours(0, 0, 0, 0);
    if (chosen <= today) {
      return res.status(400).json({ error: "Delivery date must be in the future." });
    }

    const { error: dbError } = await supabase.from("letters").insert([
      {
        email:         email.trim().toLowerCase(),
        letter:        letter.trim(),
        delivery_date,
        sent:          false,
      },
    ]);

    if (dbError) {
      console.error("Supabase insert error:", dbError);
      return res.status(500).json({ error: "Failed to save your letter. Please try again." });
    }

    return res.status(201).json({ message: "Letter sealed successfully." });
  } catch (err) {
    console.error("Unexpected error in POST /api/letters:", err);
    return res.status(500).json({ error: "An unexpected error occurred." });
  }
});

// ─── Health check ─────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// ─── Debug route ──────────────────────────────────────────
app.get("/api/debug", (req, res) => {
  res.json({
    has_resend_key: !!process.env.RESEND_API_KEY,
    resend_key_prefix: process.env.RESEND_API_KEY?.slice(0, 6) || "missing",
    has_supabase_url: !!process.env.SUPABASE_URL,
    has_service_key: !!process.env.SUPABASE_SERVICE_KEY,
    service_key_prefix: process.env.SUPABASE_SERVICE_KEY?.slice(0, 6) || "missing",
    using_key: process.env.SUPABASE_SERVICE_KEY ? "service_role" : "anon",
  });
});

// ─── Vercel Cron + manual trigger endpoint ────────────────
app.get("/api/cron", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers["authorization"];
    if (authHeader !== `Bearer ${secret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }
  try {
    await sendDueLetters();
    return res.json({ ok: true, message: "Cron ran successfully." });
  } catch (err) {
    console.error("[/api/cron] Error:", err);
    return res.status(500).json({ error: "Cron job failed." });
  }
});

// ─── Email HTML template ───────────────────────────────────
function buildEmailHtml(letter, deliveryDate) {
  const formattedDate = new Date(deliveryDate + "T00:00:00").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const escapedLetter = letter
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>A Letter From Your Past Self</title>
</head>
<body style="margin:0;padding:0;background-color:#080d1a;font-family:'Georgia',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080d1a;min-height:100vh;">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td align="center" style="padding-bottom:12px;">
              <div style="font-size:32px;color:#c9a96e;filter:drop-shadow(0 0 16px rgba(201,169,110,0.6));">✦</div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:6px;">
              <span style="font-family:Georgia,serif;font-size:11px;letter-spacing:4px;text-transform:uppercase;color:#a07d4a;">
                TimeCapsula
              </span>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:40px;">
              <div style="width:60px;height:1px;background:linear-gradient(90deg,transparent,#a07d4a,transparent);margin:16px auto 0;"></div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:8px;">
              <h1 style="font-family:Georgia,serif;font-weight:400;font-size:clamp(22px,4vw,32px);color:#f0e8d8;margin:0;line-height:1.3;">
                A letter arrived for you.
              </h1>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:40px;">
              <p style="font-family:Georgia,serif;font-style:italic;font-size:15px;color:#c8bfaf;margin:12px 0 0;line-height:1.7;">
                Written by the person you were, delivered to the person you've become.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#0d1628;border:1px solid rgba(201,169,110,0.18);border-radius:4px;padding:40px 44px;">
              <div style="font-family:Georgia,serif;font-size:16px;color:#f0e8d8;line-height:2;font-weight:400;">
                ${escapedLetter}
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:32px;padding-bottom:48px;">
              <div style="display:inline-block;padding:10px 24px;border:1px solid rgba(201,169,110,0.2);border-radius:2px;">
                <span style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#a07d4a;">
                  Opened on ${formattedDate}
                </span>
              </div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <div style="width:60px;height:1px;background:linear-gradient(90deg,transparent,#a07d4a,transparent);margin:0 auto 20px;"></div>
              <p style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#a07d4a;opacity:0.4;margin:0;">
                TimeCapsula — Your words, preserved across time
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Daily cron: send due letters ─────────────────────────
async function sendDueLetters() {
  const today = new Date().toISOString().split("T")[0];
  console.log(`[cron] Checking for letters due on ${today}…`);

  const { data: letters, error } = await supabase
    .from("letters")
    .select("*")
    .eq("delivery_date", today)
    .eq("sent", false);

  if (error) {
    console.error("[cron] Supabase fetch error:", error);
    return;
  }

  if (!letters || letters.length === 0) {
    console.log("[cron] No letters due today.");
    return;
  }

  console.log(`[cron] Found ${letters.length} letter(s) to send.`);

  for (const row of letters) {
    try {
      const { error: emailError } = await resend.emails.send({
        from:    "TimeCapsula <letters@timecapsula.fun>",
        to:      row.email,
        subject: "✦ A letter from your past self has arrived",
        html:    buildEmailHtml(row.letter, row.delivery_date),
      });

      if (emailError) {
        console.error(`[cron] Failed to send to ${row.email}:`, emailError);
        continue;
      }

      const { error: updateError } = await supabase
        .from("letters")
        .update({ sent: true })
        .eq("id", row.id);

      if (updateError) {
        console.error(`[cron] Failed to mark letter ${row.id} as sent:`, updateError);
      } else {
        console.log(`[cron] ✓ Sent and marked: ${row.email} (id: ${row.id})`);
      }
    } catch (err) {
      console.error(`[cron] Unexpected error for letter ${row.id}:`, err);
    }
  }
}

// ─── Start server (local only) ────────────────────────────
const PORT = process.env.PORT || 3000;

if (process.env.VERCEL !== "1") {
  cron.schedule("0 8 * * *", sendDueLetters);
  app.listen(PORT, () => {
    console.log(`🌌  TimeCapsula server running on http://localhost:${PORT}`);
    console.log(`⏰  Daily cron scheduled at 08:00 AM`);
  });
}

// ─── Export for Vercel ────────────────────────────────────
export default app;
