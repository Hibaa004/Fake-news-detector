// ══════════════════════════════════════════════════════════
// AGENT 3 — JUGE
// VERSION CORRIGÉE ET STABLE
// ══════════════════════════════════════════════════════════

import axios from 'axios';

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

// ─────────────────────────────────────────────────────────
// FILTRER LES SOURCES INUTILES
// ─────────────────────────────────────────────────────────

function filtrerPreuves(preuves = []) {

  const motsInterdits = [
    'dictionnaire',
    'wiktionary',
    'spotify',
    'instagram',
    'wordhippo',
    'reverso',
    'vocabulix',
    'mots-croises',
    'youtube.com/@',
    'lerobert',
    'collinsdictionary',
    'fsolver',
  ];

  return preuves.filter(preuve => {

    const url =
      (preuve.url || '').toLowerCase();

    const extrait =
      (preuve.extrait || '').toLowerCase();

    // URL inutile
    const urlInvalide =
      motsInterdits.some(m =>
        url.includes(m)
      );

    // extrait trop court
    const extraitInvalide =
      extrait.length < 30;

    return !urlInvalide &&
           !extraitInvalide;
  });
}

// ─────────────────────────────────────────────────────────
// CLASSIFICATION SIMPLE
// ─────────────────────────────────────────────────────────

function analyserPreuves(
  affirmation,
  preuves
) {

  const texte =
    affirmation.toLowerCase();

  const arguments_pour = [];
  const arguments_contre = [];
  const sources_citees = [];

  // affirmations connues fausses
  const affirmationsFausses = [
    'terre plate',
    'terre est plate',
    'vaccins causent l\'autisme',
    'vaccins causent lautisme',
    '5g cause covid',
  ];

  const estAffirmationFausse =
    affirmationsFausses.some(a =>
      texte.includes(a)
    );

  for (const preuve of preuves) {

    if (preuve.url) {
      sources_citees.push(preuve.url);
    }

    if (!preuve.extrait) {
      continue;
    }

    // si affirmation connue fausse
    if (estAffirmationFausse) {

      arguments_contre.push(
        preuve.extrait
      );

    } else {

      arguments_pour.push(
        preuve.extrait
      );
    }
  }

  return {
    arguments_pour:
      [...new Set(arguments_pour)].slice(0, 5),

    arguments_contre:
      [...new Set(arguments_contre)].slice(0, 5),

    sources_citees:
      [...new Set(sources_citees)].slice(0, 15),

    estAffirmationFausse,
  };
}

// ─────────────────────────────────────────────────────────
// GEMINI ANALYSE
// ─────────────────────────────────────────────────────────

async function analyseGemini(
  affirmation,
  preuves
) {

  const prompt = `
Tu es un expert en fact-checking.

Analyse cette affirmation :
"${affirmation}"

Voici les preuves :

${preuves.map(p => `
Source: ${p.source}
Extrait: ${p.extrait}
URL: ${p.url}
`).join('\n')}

Retourne UNIQUEMENT un JSON valide :

{
  "verdict": "VRAI|FAUX|INCERTAIN",
  "score_fiabilite": 0,
  "biais_detectes": [],
  "recommandation": ""
}
`;

  const response =
    await axios.post(
      GEMINI_URL,
      {
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1000,
        }
      }
    );

  let texte =
    response.data.candidates[0]
      .content.parts[0].text;

  texte = texte
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();

  return JSON.parse(texte);
}

// ─────────────────────────────────────────────────────────
// FONCTION PRINCIPALE
// ─────────────────────────────────────────────────────────

async function juger(
  preuvesAgent2
) {

  try {

    console.log(
      '\n===== AGENT 3 ====='
    );

    const affirmation =
      preuvesAgent2.affirmation;

    // récupérer preuves
    let preuves =
      preuvesAgent2.resultats || [];

    // filtrage
    preuves =
      filtrerPreuves(preuves);

    console.log(
      'Preuves valides:',
      preuves.length
    );

    // aucune preuve
    if (preuves.length === 0) {

      return {
        affirmation,
        verdict: 'INCERTAIN',
        score_fiabilite: 30,
        arguments_pour: [],
        arguments_contre: [],
        biais_detectes: [
          'Aucune preuve trouvée'
        ],
        sources_citees: [],
        recommandation:
          'Aucune source fiable trouvée.',
      };
    }

    // analyse locale
    const analyseLocale =
      analyserPreuves(
        affirmation,
        preuves
      );

    // tentative Gemini
    let analyseIA = null;

    try {

      analyseIA =
        await analyseGemini(
          affirmation,
          preuves
        );

    } catch (e) {

      console.warn(
        '[Gemini ERROR]',
        e.message
      );
    }

    // fallback intelligent
    let verdict = 'INCERTAIN';
    let score = 50;

    if (
      analyseLocale.estAffirmationFausse
    ) {

      verdict = 'FAUX';
      score = 90;

    } else if (
      analyseLocale.arguments_pour.length >= 3
    ) {

      verdict = 'VRAI';
      score = 80;
    }

    // Gemini override si valide
    if (
      analyseIA &&
      analyseIA.verdict
    ) {

      verdict =
        analyseIA.verdict;

      score =
        analyseIA.score_fiabilite || score;
    }

    return {

      affirmation,

      verdict,

      score_fiabilite: score,

      arguments_pour:
        analyseLocale.arguments_pour,

      arguments_contre:
        analyseLocale.arguments_contre,

      biais_detectes:
        analyseIA?.biais_detectes || [],

      sources_citees:
        analyseLocale.sources_citees,

      recommandation:
        analyseIA?.recommandation ||
        'Analyse terminée avec succès.',
    };

  } catch (error) {

    console.error(
      '[AGENT 3 ERROR]',
      error.message
    );

    return {

      affirmation:
        preuvesAgent2.affirmation,

      verdict: 'INCERTAIN',

      score_fiabilite: 50,

      arguments_pour: [],

      arguments_contre: [],

      biais_detectes: [
        'Erreur analyse IA'
      ],

      sources_citees: [],

      recommandation:
        'Vérifier manuellement avec des sources fiables.',
    };
  }
}

export default { juger };