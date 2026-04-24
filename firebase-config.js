import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBIBdhaaSdxDovXN7Y__Od2bpnq8o_m8VA",
    authDomain: "cloudinventorysystem.firebaseapp.com",
    projectId: "cloudinventorysystem",
    storageBucket: "cloudinventorysystem.firebasestorage.app",
    messagingSenderId: "359980183716",
    appId: "1:359980183716:web:a56e1dfff5d39e650ff631"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };
