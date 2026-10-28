# EarnPlay Firebase Starter

A starter scaffold for an EarnPlay-style Telegram video rewards app:
- HTML user panel + Firebase Web SDK
- Admin HTML upload page
- Firebase Authentication, Firestore, Storage
- Cloud Functions for admin video publishing and Telegram notifications
- Withdrawal status notifications (approved/rejected)
- Referral attribution data model

## Important before deployment
This is a scaffold, not a production payment system. It does not validate ad-network completions or automatically pay money. Never trust a reward amount supplied by browser JavaScript. Add server-side verification, abuse prevention, legal review, and provider-compliant ad integrations before enabling real rewards.

## Structure
- `public/index.html` — simple user panel integration example
- `public/admin.html` — admin-only video upload/publish UI
- `public/firebase-config.example.js` — replace with your Firebase web app config, then rename to `firebase-config.js`
- `public/user-panel.js` — loads published videos and creates referral links
- `public/admin.js` — uploads video to Firebase Storage and calls a secure Cloud Function
- `functions/index.js` — callable functions: publish video, set withdrawal status, apply referral
- `firestore.rules` — baseline access control
- `storage.rules` — Storage upload access control

## Setup
1. Create a Firebase project at https://console.firebase.google.com/
2. Enable **Authentication** (Email/Password for admin; choose a sign-in method for users).
3. Create a **Cloud Firestore** database and enable **Firebase Storage**.
4. Install Node.js 20+ and Firebase CLI:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase init
   ```
   Select Firestore, Functions, Hosting, and Storage. Choose JavaScript for Functions and Node 20.
5. Copy `public/firebase-config.example.js` to `public/firebase-config.js`, fill in your web app config. Do not put the Telegram bot token in any public file.
6. In `functions/`, run `npm install firebase-admin firebase-functions`.
7. Set function secrets:
   ```bash
   firebase functions:secrets:set TELEGRAM_BOT_TOKEN
   firebase functions:secrets:set TELEGRAM_CHANNEL_ID
   ```
   For `TELEGRAM_CHANNEL_ID`, use your channel's `@username` or numeric chat ID. The bot must be an admin of the channel with permission to post.
8. Assign the Firebase custom claim `admin: true` to your own user from a trusted admin script/environment. Never let a browser set its own admin claim. See Firebase Admin SDK docs.
9. Deploy rules and functions:
   ```bash
   firebase deploy --only firestore:rules,storage,functions,hosting
   ```
10. Add `public/firebase-config.js` to `.gitignore` if you prefer not to commit project config. Firebase web config is not a secret, but Security Rules are mandatory.
11. Configure Hosting's public directory as `public`.

## Video publishing flow
1. Admin signs in with Firebase Authentication.
2. `admin.html` uploads the video to `videos/{uid}/{randomName}` in Storage.
3. The page calls `publishVideo` callable function.
4. The function checks the caller's `admin` custom claim, creates a Firestore video document with a unique Firestore document ID, then posts the video to Telegram using `sendVideo`.
5. Telegram's `message_id` and channel ID are saved to the video document if the post succeeds. If Telegram fails, the video record remains with `telegramStatus: "failed"` and the error is logged.

A Firestore document ID is the canonical unique file/video ID. A sequential display number is not a secure identifier and must not be used as authorization.

## Referral flow
The example uses a referral code /start parameter as attribution. A production Telegram bot should handle `/start REFERRALCODE` through a webhook (or a separate bot runtime) and call a server-side function. This starter's `applyReferral` function prevents self-referrals and changing a user's referrer, but a real deployment should also check bot identity, first-time registration, duplicate accounts, and abuse signals.

## Withdrawal status
Only a trusted admin can call `setWithdrawalStatus`. It updates the request status and sends the user a Telegram message if their Telegram chat ID is linked:
- approved: "Your withdrawal request ... has been approved."
- rejected: "Your withdrawal request ... was rejected."
This does not itself transfer money. Admins must verify and make the payout separately, then mark the status accurately.

## Security checklist
- Keep bot token in Cloud Functions secrets only.
- Use Firestore transactions for balance changes.
- Enforce admin custom claims server-side.
- Add App Check, rate limiting, audit logs, and idempotency keys.
- Do not pay rewards based only on a client-side button click.
- Verify ad-network callbacks according to each provider's terms.
- Do not store payment credentials unless necessary; restrict and protect them.
- Test all flows in Firebase Emulator Suite before production.
