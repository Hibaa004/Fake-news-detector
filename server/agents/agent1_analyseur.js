// ══════════════════════════════════════════════════════════
//  AGENT 1 — ANALYSEUR
//  CORRECTIFS :
//  - Apostrophes (d'origine → d + origine) avant tokenisation
//  - Prompt JSON simplifié
//  - Mots-clés nettoyés des stop words même en mode Gemini
//  - [FIX] En mode fallback, sous_questions = [] pour éviter
//    les requêtes parasites sur des mots isolés ('serre', 'effet'...)
// ══════════════════════════════════════════════════════════

import axios from 'axios';

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

// ─────────────────────────────────────────────────────────
// Stop words français
// ─────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  'le','la','les','un','une','des','de','du',
  'et','est','en','au','aux','ce','se','sa','son',
  'que','qui','ne','pas','plus','par','sur','dans',
  'il','elle','ils','elles','ou','où','à','y','a',
  'cette','cet','leur','leurs','mon','ton','notre','votre',
]);

// ─────────────────────────────────────────────────────────
// Normalisation du texte brut
// Remplace apostrophes + chars spéciaux par des espaces
// AVANT de découper en tokens → évite "dorigine"
// ─────────────────────────────────────────────────────────
function normaliserTexte(texte) {
  return texte
    .toLowerCase()
    .replace(/[''`´]/g, ' ')                       // apostrophes → espace
    .replace(/[^a-zàâçéèêëîïôûùüÿñæœ\s]/gi, ' ')  // tout sauf lettres/accents → espace
    .replace(/\s+/g, ' ')                           // espaces multiples → un seul
    .trim();
}

function filtrerStopWords(mots) {
  return mots.filter(m =>
    m.length > 3 && !STOP_WORDS.has(m.toLowerCase())
  );
}

// ─────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `
Tu es un expert en fact-checking. Analyse l'affirmation et retourne
UNIQUEMENT ce JSON valide, sans backticks ni commentaires :

{
  "affirmation_originale": "<affirmation exacte>",
  "sous_questions": ["<question 1>", "<question 2>", "<question 3>"],
  "mots_cles": ["<mot1>", "<mot2>", "<mot3>"],
  "criteres_pertinence": "<En une phrase : ce qu'une preuve doit contenir pour confirmer ou infirmer cette affirmation>"
}

Règles :
- mots_cles : noms propres ou communs significatifs UNIQUEMENT (jamais : est, la, de, un, d…)
- Si l'affirmation contient une apostrophe (d'origine, l'homme…), sépare bien les mots
`;

async function analyser(affirmation, tentative = 1) {

  const MAX_TENTATIVES = 2;

  try {

    const response = await axios.post(GEMINI_URL, {
      contents: [{
        parts: [{
          text: `${SYSTEM_PROMPT}\n\nAffirmation : "${affirmation}"`
        }]
      }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 600 },
    });

    let texte = response.data.candidates[0].content.parts[0].text;
    texte = texte.replace(/```json/g, '').replace(/```/g, '').trim();

    const resultat = JSON.parse(texte);

    if (!resultat.sous_questions || !Array.isArray(resultat.sous_questions)) {
      throw new Error('Structure JSON invalide');
    }

    if (!resultat.criteres_pertinence) {
      resultat.criteres_pertinence =
        `Une preuve pertinente doit traiter directement de : ${affirmation}`;
    }

    // Nettoyer les mots-clés même quand Gemini répond
    resultat.mots_cles = filtrerStopWords(resultat.mots_cles || []);

    console.log('\n[Agent 1] Analyse OK');
    console.log('[Agent 1] Mots-clés :', resultat.mots_cles);
    console.log('[Agent 1] Critères  :', resultat.criteres_pertinence);

    return resultat;

  } catch (error) {

    console.error(
      `[Agent1] Erreur tentative ${tentative}:`,
      error.response?.data?.error?.message || error.message
    );

    if (tentative < MAX_TENTATIVES) {
      console.log('[Agent1] Nouvelle tentative...');
      return analyser(affirmation, tentative + 1);
    }

    // ── Fallback : tokenisation avec gestion apostrophes ──
    const texteNormalise = normaliserTexte(affirmation);
    const tokens = texteNormalise.split(' ').filter(m =>
      m.length > 3 && !STOP_WORDS.has(m)
    );

    const motsClesFallback = tokens.slice(0, 5);

    console.warn('[Agent1] Fallback activé, mots-clés :', motsClesFallback);

    // ★ FIX CRITIQUE : sous_questions = [] en mode fallback
    // Les mots isolés ('principal', 'effet', 'serre') utilisés comme
    // requêtes séparées génèrent des résultats parasites (serres de jardin,
    // dictionnaires, Principal Financial Group...).
    // On lance uniquement l'affirmation complète comme requête.
    return {
      affirmation_originale: affirmation,
      sous_questions: [],        // ← était [affirmation], vidé intentionnellement
      mots_cles: motsClesFallback,
      criteres_pertinence:
        `Une preuve pertinente doit traiter directement de : ${affirmation}`,
      erreur: true,              // ← flag utilisé par Agent 2
    };
  }
}

export default { analyser };