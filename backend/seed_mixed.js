import { getDb } from './db.js';

async function seed() {
  const db = await getDb();
  const users = await db.all('SELECT id, email FROM users');
  const durvesh = users.find(u => u.email === 'durvesh@gmail.com');
  
  if (durvesh) {
      const generateId = () => Math.random().toString(36).substring(2, 15);
      // Date 4: March 11 (Today)
      await db.run('INSERT INTO interviews (id, user_id, role, questions, answers, scores, feedbacks, date, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', 
        [generateId(), durvesh.id, 'Frontend Developer', '["Q1"]', '["A1"]', '[8]', '["F1"]', '2026-03-11T10:00:00Z', 'standard']);
      console.log('Mock Frontend Developer interview added for durvesh@gmail.com');
  } else {
      console.log('User durvesh@gmail.com not found');
  }
}

seed().catch(console.error);
