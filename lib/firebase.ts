import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export async function testConnection() {
  console.log("Firebase Auth initialized for project:", firebaseConfig.projectId);
}
