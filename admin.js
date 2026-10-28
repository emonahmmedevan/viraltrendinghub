import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const app=initializeApp(firebaseConfig), auth=getAuth(app), storage=getStorage(app), functions=getFunctions(app);
const $=id=>document.getElementById(id);
onAuthStateChanged(auth, async user=>{
  if(!user){$("authStatus").textContent="Signed out";return}
  const token=await user.getIdTokenResult(true);
  $("authStatus").textContent=token.claims.admin?"Signed in as admin":"Signed in, but admin permission is missing.";
});
$("signIn").onclick=async()=>{try{await signInWithEmailAndPassword(auth,$("email").value,$("password").value)}catch(e){$("authStatus").textContent=e.message}};
$("signOut").onclick=()=>signOut(auth);
$("publish").onclick=async()=>{
  const user=auth.currentUser, file=$("videoFile").files[0], title=$("title").value.trim(), description=$("description").value.trim();
  if(!user){$("publishStatus").textContent="আগে সাইন ইন করুন।";return}
  if(!title||!file){$("publishStatus").textContent="ভিডিওর নাম ও ফাইল দিন।";return}
  if(!file.type.startsWith("video/")){$("publishStatus").textContent="শুধু ভিডিও ফাইল আপলোড করা যাবে।";return}
  if(file.size>500*1024*1024){$("publishStatus").textContent="এই ডেমোর সর্বোচ্চ ফাইল সাইজ 500 MB। বড় ফাইলের জন্য resumable upload / YouTube বা Telegram direct workflow বিবেচনা করুন।";return}
  $("publish").disabled=true;
  try{
    const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
    const storagePath=`videos/${user.uid}/${Date.now()}_${safeName}`;
    const upload=uploadBytesResumable(ref(storage,storagePath),file,{contentType:file.type});
    await new Promise((resolve,reject)=>upload.on("state_changed",s=>{
      $("publishStatus").textContent=`Uploading: ${Math.round(s.bytesTransferred/s.totalBytes*100)}%`;
    },reject,resolve));
    const publicUrl=await getDownloadURL(upload.snapshot.ref);
    const publishVideo=httpsCallable(functions,"publishVideo");
    const result=await publishVideo({title,description,storagePath,publicUrl,mimeType:file.type,size:file.size});
    $("publishStatus").textContent=`Published successfully!\nUnique video ID: ${result.data.videoId}\nTelegram status: ${result.data.telegramStatus}`;
  }catch(e){$("publishStatus").textContent="Publish failed: "+e.message}
  finally{$("publish").disabled=false}
};
