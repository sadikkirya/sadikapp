import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

/**
 * Callable function to create a new user from the Admin panel.
 * This handles both Firebase Auth creation and Firestore profile creation.
 */
export const adminCreateUser = onCall(async (request) => {
  // 1. Verify caller is authenticated
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  // 2. Verify caller is an admin
  const uid = request.auth.uid;
  const adminDoc = await admin.firestore().collection('admin_accounts').doc(uid).get();
  const adminData = adminDoc.data();
  if (!adminData || !['Super Admin', 'Manager'].includes(adminData.role)) {
    throw new HttpsError('permission-denied', `User ${uid} is not an authorized admin.`);
  }

  const { email, password, name, role, collection, ...otherData } = request.data;

  // Validation
  if (!email || !password || !name || !role || !collection) {
    throw new HttpsError('invalid-argument', 'Missing required user fields.');
  }

  try {
    // 3. Create user in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: name,
    });

    // 4. Create profile in the specified Firestore collection
    const profile = {
      ...otherData,
      id: userRecord.uid,
      email,
      name,
      role,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await admin.firestore().collection(collection).doc(userRecord.uid).set(profile);

    return { success: true, uid: userRecord.uid };
  } catch (error: any) {
    console.error("Error creating user:", error);
    throw new HttpsError('internal', error.message || 'Unable to create user.');
  }
});