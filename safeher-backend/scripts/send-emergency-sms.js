#!/usr/bin/env node
/**
 * Automated Emergency SMS Dispatch Script
 *
 * Dispatches emergency SMS to all registered trusted contacts without human intervention.
 *
 * Usage:
 *   node scripts/send-emergency-sms.js --email user.one@safeher.local --lat 28.6139 --lng 77.2090
 *   npm run send-sms -- --email user.one@safeher.local
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const User = require("../src/models/User");
const Contact = require("../src/models/Contact");
const { sendSms } = require("../src/routes/notify");

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=");
      args[key] = value || true;
    }
  });
  return args;
}

async function run() {
  const args = parseArgs();
  const targetEmail = args.email || process.env.EMERGENCY_USER_EMAIL || "user.one@safeher.local";
  const lat = args.lat || args.latitude;
  const lng = args.lng || args.longitude;
  const customMessage = args.message;

  console.log(`[SafeHer Auto-SMS] Looking up user: ${targetEmail}`);
  const user = await User.findOne({ email: targetEmail });
  if (!user) {
    console.error(`[Error] User with email "${targetEmail}" not found.`);
    process.exit(1);
  }

  console.log(`[SafeHer Auto-SMS] Fetching trusted contacts for: ${user.name}`);
  const contacts = await Contact.find({ owner: user._id });
  const phoneContacts = contacts.filter((c) => c.phone);

  if (phoneContacts.length === 0) {
    console.log(`[Warning] No contacts with phone numbers found for user ${user.name}.`);
    process.exit(0);
  }

  const locationLink = lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : "Current device location unavailable";
  const defaultMessage =
    `🚨 EMERGENCY ALERT (AUTOMATED):\n` +
    `${user.name} requires immediate help!\n` +
    `📍 Location: ${locationLink}\n` +
    `Timestamp: ${new Date().toLocaleString()}\n` +
    `Dispatched automatically by SafeHer. Please call 112 or check immediately.`;

  const finalMessage = customMessage || defaultMessage;
  console.log(`[SafeHer Auto-SMS] Dispatching to ${phoneContacts.length} contacts automatically...`);
  console.log(`----------------------------------------`);
  console.log(finalMessage);
  console.log(`----------------------------------------`);

  const results = [];
  for (const contact of phoneContacts) {
    console.log(`-> Sending to ${contact.name} (${contact.phone})...`);
    const result = await sendSms(contact.phone, finalMessage);
    results.push({ name: contact.name, phone: contact.phone, result });
    console.log(`   Status: ${result.ok ? "ACCEPTED" : "FAILED"} ${result.reason ? `(${result.reason})` : ""}`);
  }

  console.log(`\n[Summary] Dispatched to ${results.filter((r) => r.result.ok).length}/${phoneContacts.length} contacts.`);
}

run().catch((err) => {
  console.error("[Fatal Error]", err);
  process.exit(1);
});
