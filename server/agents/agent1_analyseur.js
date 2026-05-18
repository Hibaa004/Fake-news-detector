

import axios from 'axios';

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

// ─────────────────────────────────────────────────────────
// Stop words français
// ─────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  'le','la','les','un','une','des','de','du','d',
  'et','est','en','au','aux','ce','se','sa','son',
  'que','qui','ne','pas','plus','par','sur','dans',
  'il','elle','ils','elles','ou','où','à','y','a',
  'cette','cet','leur','leurs','mon','ton','notre','votre',
  'mais','donc','car','or','ni','ainsi','alors','selon',
]);

// ─────────────────────────────────────────────────────────
// Normalisation
// ─────────────────────────────────────────────────────────
function normaliserTexte(texte) {
  return texte
    .toLowerCase()
    .replace(/[''`´]/g, ' ')
    .replace(/[^a-zàâçéèêëîïôûùüÿñæœ0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function filtrerStopWords(mots) {
  return mots.filter(m =>
    m.length > 2 && !STOP_WORDS.has(m.toLowerCase())
  );
}

// ─────────────────────────────────────────────────────────
// Prompt générique : détecte le TYPE d'affirmation et
// extrait une structure sémantique adaptée
// ─────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `
Tu es un expert en fact-checking. Analyse l'affirmation et retourne
UNIQUEMENT ce JSON valide, sans backticks ni commentaires :

{
  "affirmation_originale": "<affirmation exacte>",
  "type_affirmation": "<identite|causalite|statistique|temporelle|comparative|existence|citation|geographique|scientifique|autre>",
  "sous_questions": ["<question 1>", "<question 2>", "<question 3>"],
  "mots_cles": ["<mot1>", "<mot2>", "<mot3>"],
  "criteres_pertinence": "<En une phrase : ce qu'une preuve doit contenir pour confirmer ou infirmer cette affirmation>",
  "negation_attendue": "<ce qui CONTREDIRAIT l'affirmation — ex: 'X est premier ministre et non roi', 'taux réel est 30% et non 70%'>",
  "structure": {
    "sujet": "<la personne, entité ou concept principal>",
    "predicat": "<ce qui est affirmé sur le sujet — ex: est roi, cause le cancer, représente 70%, a dit que...>",
    "contexte": "<pays, domaine, période, groupe concerné>"
  }
}

Règles IMPORTANTES :
- type_affirmation : choisis le type le plus précis parmi la liste
- mots_cles : termes significatifs UNIQUEMENT — jamais de mots vides (est, la, de, un, d…)
- structure.predicat : sois TRÈS PRÉCIS — c'est le cœur de l'affirmation
  • "X est roi"             → predicat = "est roi"
  • "X cause le cancer"     → predicat = "cause le cancer"
  • "X représente 70%"      → predicat = "représente 70%"
  • "X a dit que Y"         → predicat = "a déclaré que [citation]"
- negation_attendue : formule la contradiction directe de l'affirmation
`;

// ─────────────────────────────────────────────────────────
// Extraction fallback basique (si Gemini échoue)
// ─────────────────────────────────────────────────────────
function extraireStructureFallback(affirmation) {
  const texte = normaliserTexte(affirmation);

  let type = 'autre';

  if (/\best\b|\bsont\b|\bétait\b|\bétaient\b/.test(texte)
      && /\broi|\breine|\bprésident|\bpremier ministre|\bchef|\bministre/.test(texte)) {
    type = 'identite';
  }
  else if (/\bcause|\bprovoque|\bentraîn|\bresponsabl/.test(texte)) {
    type = 'causalite';
  }
  else if (/\d+\s*%|\bpourcent/.test(texte)) {
    type = 'statistique';
  }

  // ─────────────────────────────────────────
  // EXTRACTION IDENTITÉ ROBUSTE
  // Pattern :
  //   "X est Y"
  //   "Y est X"
  // ─────────────────────────────────────────

  let sujet = '';
  let predicat = '';
  let contexte = '';

  const matchEst = texte.match(/(.+?)\s+est\s+(.+)/i);

  if (matchEst) {
    const gauche = matchEst[1].trim();
    const droite = matchEst[2].trim();

    // Cas :
    // "le roi du maroc est akhannouche"
    if (/\broi|\breine|\bprésident|\bpremier ministre|\bchef/.test(gauche)) {
      sujet = droite;
      predicat = gauche;
    }
    else {
      sujet = gauche;
      predicat = droite;
    }
  }

  // fallback ultime
  if (!sujet || !predicat) {
    const tokens = texte
      .split(' ')
      .filter(m => m.length > 2 && !STOP_WORDS.has(m));

    sujet = tokens[0] || '';
    predicat = tokens.slice(1, 4).join(' ') || '';
    contexte = tokens.slice(4, 7).join(' ') || '';
  }

  // ─────────────────────────────────────────
  // Génération auto negation_attendue
  // ─────────────────────────────────────────

  let negation = '';

  if (predicat.includes('roi')) {
    negation = 'premier ministre chef du gouvernement';
  }
  else if (predicat.includes('président')) {
    negation = 'ministre premier ministre';
  }

  return {
    sujet,
    predicat,
    contexte,
    type,
    negation_attendue: negation,
  };
}

// ─────────────────────────────────────────────────────────
// Fonction principale
// ─────────────────────────────────────────────────────────
async function analyser(affirmation, tentative = 1) {
  const MAX_TENTATIVES = 2;

  try {
    const response = await axios.post(GEMINI_URL, {
      contents: [{
        parts: [{
          text: `${SYSTEM_PROMPT}\n\nAffirmation : "${affirmation}"`
        }]
      }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
    });

    let texte = response.data.candidates[0].content.parts[0].text;
    texte = texte.replace(/```json/g, '').replace(/```/g, '').trim();

    const resultat = JSON.parse(texte);

    // Validation minimale
    if (!resultat.sous_questions || !Array.isArray(resultat.sous_questions)) {
      throw new Error('Structure JSON invalide : sous_questions manquant');
    }

    // Valeurs par défaut
    if (!resultat.criteres_pertinence) {
      resultat.criteres_pertinence =
        `Une preuve pertinente doit traiter directement de : ${affirmation}`;
    }

   if (!resultat.negation_attendue) {

  const p = normaliserTexte(
    resultat.structure?.predicat || ''
  );

  if (p.includes('roi')) {
    resultat.negation_attendue =
      'premier ministre chef du gouvernement';
  }
  else if (p.includes('président')) {
    resultat.negation_attendue =
      'ministre premier ministre';
  }
  else {
    resultat.negation_attendue = '';
  }
}

    if (!resultat.type_affirmation) {
      resultat.type_affirmation = 'autre';
    }

    // Nettoyage des mots-clés
    resultat.mots_cles = filtrerStopWords(resultat.mots_cles || []);

    // Structure par défaut si absente
    if (!resultat.structure) {
      const fb = extraireStructureFallback(affirmation);
      resultat.structure = {
        sujet:    fb.sujet,
        predicat: fb.predicat,
        contexte: fb.contexte,
      };
    }

    // Compatibilité rétroactive : expose aussi predicat comme role_revendique
    // pour que les agents 2 et 3 puissent utiliser les deux noms de champ
    resultat.structure.role_revendique = resultat.structure.predicat;
    resultat.structure.entite          = resultat.structure.contexte;

    console.log('\n[Agent 1] ✅ Analyse OK');
    console.log('[Agent 1] Type            :', resultat.type_affirmation);
    console.log('[Agent 1] Mots-clés       :', resultat.mots_cles);
    console.log('[Agent 1] Critères        :', resultat.criteres_pertinence);
    console.log('[Agent 1] Négation att.   :', resultat.negation_attendue);
    console.log('[Agent 1] Structure       :', JSON.stringify(resultat.structure));

    return resultat;

  } catch (error) {
    console.error(`[Agent1] Erreur tentative ${tentative}:`,
      error.response?.data?.error?.message || error.message);

    if (tentative < MAX_TENTATIVES) {
      console.log('[Agent1] Nouvelle tentative...');
      return analyser(affirmation, tentative + 1);
    }

    // ── Fallback complet ─────────────────────────────────
    const fb = extraireStructureFallback(affirmation);
    const tokens = normaliserTexte(affirmation)
      .split(' ')
      .filter(m => m.length > 2 && !STOP_WORDS.has(m));

    console.warn('[Agent1] ⚠ Fallback activé, mots-clés :', tokens.slice(0, 6));

    return {
      affirmation_originale: affirmation,
      type_affirmation:      fb.type,
      sous_questions:        [],
      mots_cles:             tokens.slice(0, 6),
      criteres_pertinence:
        `Une preuve pertinente doit traiter directement de : ${affirmation}`,
      negation_attendue: '',
      structure: {
        sujet:           fb.sujet,
        predicat:        fb.predicat,
        contexte:        fb.contexte,
        role_revendique: fb.predicat,  // rétrocompat
        entite:          fb.contexte,  // rétrocompat
      },
      erreur: true,
    };
  }
}

export default { analyser };