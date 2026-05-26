// ══════════════════════════════════════════════════════════
//  SERVICE GOOGLE SHEETS
//  Equivalent du nœud "Append or update row in sheet" dans n8n
// ══════════════════════════════════════════════════════════
const axios = require('axios');

const SHEETS_WEBHOOK = process.env.GOOGLE_SHEETS_ID; // URL Apps Script

async function logToSheets(data) {
  if (!SHEETS_WEBHOOK) {
    console.warn('[Sheets] GOOGLE_SHEETS_ID non configuré — log ignoré');
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
