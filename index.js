const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const botToken = defineSecret("TELEGRAM_BOT_TOKEN");
const channelId = defineSecret("TELEGRAM_CHANNEL_ID");

function requireAdmin(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  if (request.auth.token.admin !== true) throw new HttpsError("permission-denied", "Admin only.");
}
async function telegram(method, payload, token) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || "Telegram API error");
  return data.result;
}

exports.publishVideo = onCall({ secrets: [botToken, channelId], timeoutSeconds: 120, memory: "512MiB" }, async request => {
  requireAdmin(request);
  const { title, description = "", storagePath, publicUrl, mimeType, size } = request.data || {};
  if (typeof title !== "string" || !title.trim() || title.length > 120) throw new HttpsError("invalid-argument", "Valid title required.");
  if (typeof storagePath !== "string" || !storagePath.startsWith(`videos/${request.auth.uid}/`)) throw new HttpsError("invalid-argument", "Invalid storage path.");
  if (typeof publicUrl !== "string" || !publicUrl.startsWith("https://")) throw new HttpsError("invalid-argument", "Valid HTTPS URL required.");
  if (typeof mimeType !== "string" || !mimeType.startsWith("video/")) throw new HttpsError("invalid-argument", "Video file required.");
  if (!Number.isFinite(size) || size <= 0 || size > 500 * 1024 * 1024) throw new HttpsError("invalid-argument", "Invalid video size.");
  const videoRef = db.collection("videos").doc();
  await videoRef.set({
    title: title.trim(), description: String(description).slice(0, 500), storagePath, publicUrl,
    mimeType, size, status: "publishing", telegramStatus: "pending",
    createdBy: request.auth.uid, createdAt: admin.firestore.FieldValue.serverTimestamp(),
    telegramMessageId: null, telegramChannelId: channelId.value()
  });
  try {
    const caption = `🎬 ${title.trim()}\n${String(description).slice(0, 700)}\n\n🆔 Video ID: ${videoRef.id}`;
    // Telegram sendVideo accepts an HTTP URL, but large files / private Firebase URLs may fail.
    // For robust delivery, upload bytes or use a Telegram file_id saved after the first upload.
    const result = await telegram("sendVideo", {
      chat_id: channelId.value(), video: publicUrl, caption: caption.slice(0, 1024)
    }, botToken.value());
    await videoRef.update({
      status: "published", telegramStatus: "posted",
      telegramMessageId: result.message_id,
      telegramPostedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { videoId: videoRef.id, telegramStatus: "posted", telegramMessageId: result.message_id };
  } catch (error) {
    await videoRef.update({ status: "published", telegramStatus: "failed", telegramError: String(error.message).slice(0, 300) });
    // Do not expose bot token or full upstream details to browser.
    throw new HttpsError("internal", `Video saved, but Telegram posting failed. Video ID: ${videoRef.id}`);
  }
});

// Create a withdrawal request from a trusted user-facing callable (not implemented in this minimal scaffold).
// Admin status changes are checked server-side and trigger a Telegram message to the linked user's chat.
exports.setWithdrawalStatus = onCall({ secrets: [botToken], timeoutSeconds: 30 }, async request => {
  requireAdmin(request);
  const { withdrawalId, status, adminNote = "" } = request.data || {};
  if (typeof withdrawalId !== "string" || !["approved", "rejected"].includes(status)) {
    throw new HttpsError("invalid-argument", "withdrawalId and approved/rejected status required.");
  }
  const ref = db.collection("withdrawals").doc(withdrawalId);
  let userId, amount, paymentMethod, accountLast4;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Withdrawal not found.");
    const w = snap.data();
    if (w.status !== "pending") throw new HttpsError("failed-precondition", "Withdrawal already processed.");
    userId = w.userId; amount = w.amount; paymentMethod = w.paymentMethod || "payment method"; accountLast4 = w.accountLast4 || "";
    tx.update(ref, {
      status, adminNote: String(adminNote).slice(0, 300),
      reviewedBy: request.auth.uid, reviewedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  const userSnap = await db.collection("users").doc(userId).get();
  const chatId = userSnap.exists ? userSnap.data().telegramChatId : null;
  let notification = "not_sent";
  if (chatId) {
    const message = status === "approved"
      ? `✅ Your EarnPlay withdrawal request has been approved.\nAmount: ৳${Number(amount).toFixed(2)}\nMethod: ${paymentMethod}\nReference: ${withdrawalId}\n\nPlease allow time for payment processing.`
      : `❌ Your EarnPlay withdrawal request was rejected.\nAmount: ৳${Number(amount).toFixed(2)}\nMethod: ${paymentMethod}\nReference: ${withdrawalId}${adminNote ? `\nReason: ${String(adminNote).slice(0, 250)}` : ""}\n\nPlease contact support if you need help.`;
    try { await telegram("sendMessage", { chat_id: chatId, text: message }, botToken.value()); notification = "sent"; }
    catch (e) { console.error("Withdrawal notification failed", e.message); notification = "failed"; }
  }
  return { withdrawalId, status, notification };
});

// This callable is intended to be invoked by a trusted Telegram webhook or controlled signup flow.
// It never accepts a referrer UID from a browser without validating the code against Firestore.
exports.applyReferral = onCall(async request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const { referralCode } = request.data || {};
  if (typeof referralCode !== "string" || !referralCode.trim()) throw new HttpsError("invalid-argument", "Referral code required.");
  const newUserId = request.auth.uid;
  const userRef = db.collection("users").doc(newUserId);
  const codeQuery = await db.collection("users").where("referralCode", "==", referralCode.trim()).limit(1).get();
  if (codeQuery.empty) throw new HttpsError("not-found", "Referral code not found.");
  const referrerDoc = codeQuery.docs[0];
  if (referrerDoc.id === newUserId) throw new HttpsError("failed-precondition", "Self-referral is not allowed.");
  await db.runTransaction(async tx => {
    const userSnap = await tx.get(userRef);
    if (userSnap.exists && userSnap.data().referredBy) throw new HttpsError("already-exists", "Referral already applied.");
    tx.set(userRef, { referredBy: referrerDoc.id, referralAppliedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    tx.set(db.collection("referrals").doc(`${referrerDoc.id}_${newUserId}`), {
      referrerId: referrerDoc.id, referredUserId: newUserId, status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  // Telegram notification is sent when a verified Telegram webhook/chat mapping exists.
  return { success: true, status: "pending_verification" };
});


// Automatically notifies the referrer when a referral record is created.
// For delivery, the referrer's users/{uid}.telegramChatId must have been linked
// through a verified Telegram /start flow; never trust a chat ID submitted by a browser.
exports.onReferralCreated = onDocumentCreated({ document: "referrals/{referralId}", secrets: [botToken] }, async event => {
  const referral = event.data.data();
  const userSnap = await db.collection("users").doc(referral.referrerId).get();
  const chatId = userSnap.exists ? userSnap.data().telegramChatId : null;
  if (!chatId) {
    console.log("Referral created; referrer has no linked Telegram chat", event.params.referralId);
    return;
  }
  const referredSnap = await db.collection("users").doc(referral.referredUserId).get();
  const displayName = referredSnap.exists ? (referredSnap.data().displayName || "New user") : "New user";
  try {
    await telegram("sendMessage", {
      chat_id: chatId,
      text: `🎉 নতুন রেফারেল!\n${String(displayName).slice(0, 100)} আপনার রেফারেল লিংক ব্যবহার করে যোগ দিয়েছেন।\nস্ট্যাটাস: যাচাই অপেক্ষমাণ।`
    }, botToken.value());
  } catch (error) {
    console.error("Referral Telegram notification failed", error.message);
  }
});

// Optional callable for a trusted bot webhook after it has authenticated the Telegram update.
// Keep this endpoint inaccessible to arbitrary browsers in production.
exports.notifyReferral = onCall({ secrets: [botToken] }, async request => {
  requireAdmin(request);
  const { referrerUid, referredDisplayName = "New user", telegramChatId } = request.data || {};
  if (typeof referrerUid !== "string" || !telegramChatId) throw new HttpsError("invalid-argument", "Missing referral notification fields.");
  const text = `🎉 New referral!\nUser: ${String(referredDisplayName).slice(0, 100)}\nYour referral has been recorded and is pending verification.`;
  await telegram("sendMessage", { chat_id: telegramChatId, text }, botToken.value());
  return { sent: true };
});
