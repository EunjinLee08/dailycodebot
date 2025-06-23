import { db } from '../firebase.js';

export async function saveCheckin(userId, date) {
  const safeDate = date.replace(/\//g, '-');
  await db.collection('checkins').doc(`${userId}_${safeDate}`).set({
    userId,
    date: safeDate, // ✅ 여기 수정
    timestamp: new Date()
  });
}

export async function getCertifiedUsers(date) {
  const safeDate = date.replace(/\//g, '-');
  const snapshot = await db.collection('checkins')
    .where('date', '==', safeDate)
    .get();

  return snapshot.docs.map(doc => doc.data().userId);
}

