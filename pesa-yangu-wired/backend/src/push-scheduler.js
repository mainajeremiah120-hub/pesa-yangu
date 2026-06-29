"use strict";
/**
 * Fires twice daily at 08:00 and 20:00 EAT (UTC+3)
 * → 05:00 and 17:00 UTC
 * Sends a push notification to every active subscriber reminding them
 * to record their transactions.
 */
const webpush = require("web-push");
const { query } = require("./models/db");

const MESSAGES = [
  { title: "Morning check-in 💰", body: "Don't forget to record your expenses today — tap to open Pesa Yangu." },
  { title: "Evening wrap-up 📊", body: "How did spending go today? Take a moment to record your transactions." },
  { title: "Money check-in ☀️",  body: "Start the day right — log any expenses or income from yesterday." },
  { title: "End of day 🌙",      body: "A quick minute to record today's transactions keeps your finances clear." },
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function sendDailyReminder(slot) {
  const msg = slot === "morning"
    ? pick(MESSAGES.slice(0, 2))
    : pick(MESSAGES.slice(2));

  let sent = 0, failed = 0;
  try {
    const { rows } = await query("SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions");
    for (const sub of rows) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: msg.title, body: msg.body, url: "/" }),
          { TTL: 3600 }
        );
        sent++;
      } catch (err) {
        // 410 Gone = subscription expired — clean it up
        if (err.statusCode === 410 || err.statusCode === 404) {
          await query("DELETE FROM push_subscriptions WHERE id=$1", [sub.id]).catch(() => {});
        }
        failed++;
      }
    }
    console.log(`[push] ${slot} reminder: sent=${sent} failed=${failed}`);
  } catch (err) {
    console.error("[push] scheduler error:", err.message);
  }
}

function scheduleReminders() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn("[push] VAPID keys not set — push notifications disabled");
    return;
  }

  webpush.setVapidDetails(
    process.env.VAPID_MAILTO || "mailto:admin@pesayangu.africa",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  // Fire at 05:00 UTC (08:00 EAT) and 17:00 UTC (20:00 EAT)
  // We use setInterval checking every minute instead of a cron library
  // to avoid an extra dependency.
  setInterval(() => {
    const now = new Date();
    const hUtc = now.getUTCHours();
    const mUtc = now.getUTCMinutes();
    if (mUtc !== 0) return; // only fire at the top of the hour
    if (hUtc === 5)  sendDailyReminder("morning");
    if (hUtc === 17) sendDailyReminder("evening");
  }, 60 * 1000);

  console.log("[push] Reminder scheduler started (08:00 & 20:00 EAT)");
}

module.exports = { scheduleReminders, sendDailyReminder };
