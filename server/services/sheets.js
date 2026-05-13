// ══════════════════════════════════════════════════════════
//  SERVICE GOOGLE SHEETS
//  Equivalent du nœud "Append or update row in sheet" dans n8n
// ══════════════════════════════════════════════════════════
const axios = require('axios');

// Note : Pour Google Sheets en production, utiliser googleapis
// Pour la version simple, on utilise une Google Apps Script Web App
// Voir README pour la configuration

const SHEETS_WEBHOOK = process.env.SHEETS_WEBHOOK_URL; // URL Apps Script

async function logToSheets(data) {
  if (!SHEETS_WEBHOOK) {
    console.warn('[Sheets] SHEETS_WEBHOOK_URL non configuré — log ignoré');
    return;
  }

  try {
    await axios.post(SHEETS_WEBHOOK, data, { timeout: 10000 });
    console.log('[Sheets] ✅ Ligne ajoutée dans Google Sheets');
  } catch (error) {
    console.error('[Sheets] ❌ Erreur:', error.message);
    // Ne pas bloquer le pipeline si Sheets échoue
  }
}

module.exports = { logToSheets };
