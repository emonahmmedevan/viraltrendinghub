import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, query, where, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

$("signInBtn").addEventListener("click", async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { alert("Sign-in failed: " + e.message); }
});
onAuthStateChanged(auth, async user => {
  $("userLabel").textContent = user?.displayName || user?.email || "EarnPlay User";
  $("signInBtn").textContent = user ? "Signed in" : "Sign in";
  if (user) {
    $("refLink").value = `https://t.me/YOUR_BOT_USERNAME?start=${encodeURIComponent(user.uid)}`;
    // TODO: fetch the user's profile from a callable function or user-owned document.
    await loadVideos();
  } else {
    $("videoList").innerHTML = '<p class="muted">ভিডিও দেখতে সাইন ইন করুন।</p>';
    $("refLink").value = "লগইন করার পর লিংক তৈরি হবে";
  }
});
$("reloadVideos").addEventListener("click", loadVideos);
$("copyReferral").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("refLink").value); alert("Referral link copied"); }
  catch { $("refLink").select(); document.execCommand("copy"); alert("লিংক কপি করার চেষ্টা করা হয়েছে"); }
});
async function loadVideos() {
  try {
    const q = query(collection(db, "videos"), where("status", "==", "published"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    $("videoList").innerHTML = "";
    if (snap.empty) { $("videoList").innerHTML = '<p class="muted">এখনো কোনো ভিডিও প্রকাশিত হয়নি।</p>'; return; }
    snap.forEach(docSnap => {
      const v = docSnap.data();
      const card = document.createElement("article");
      card.className = "video";
      const thumb = document.createElement("div"); thumb.className = "thumb"; thumb.textContent = "▶";
      const body = document.createElement("div"); body.className = "video-body";
      const h = document.createElement("h3"); h.textContent = v.title || "Untitled video";
      const p = document.createElement("p"); p.className = "muted"; p.textContent = `Video ID: ${docSnap.id}`;
      const a = document.createElement("a"); a.className = "btn"; a.textContent = "Watch video"; a.href = v.publicUrl || "#"; a.target = "_blank"; a.rel = "noopener noreferrer";
      body.append(h,p,a); card.append(thumb,body); $("videoList").append(card);
    });
  } catch (e) { $("videoList").innerHTML = `<p class="muted">ভিডিও লোড হয়নি: ${escapeHtml(e.message)}</p>`; }
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
