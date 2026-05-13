// ══════════════════════════════════════════════════════════
//  AGENT 1 — ANALYSEUR
// ══════════════════════════════════════════════════════════

import axios from 'axios';

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

const SYSTEM_PROMPT = `
Tu es un expert en épistémologie et vérification des faits.

Tu reçois une affirmation brute.

Ta mission :
- Décomposer l'affirmation en 3 à 5 sous-questions
- Extraire les mots-clés importants

Retourne UNIQUEMENT un JSON valide :
{
  "affirmation_originale": "...",
  "sous_questions": [],
  "mots_cles": []
}
`;

async function analyser(affirmation, tentative = 1) {

  const MAX_TENTATIVES = 2;

  try {

    const response = await axios.post(
      GEMINI_URL,
      {
        contents: [
          {
            parts: [
              {
                text:
                  `${SYSTEM_PROMPT}\n\nAffirmation : ${affirmation}`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1000,
        }
      }
    );

    let texte =
      response.data.candidates[0]
      .content.parts[0].text;

    texte =
      texte
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

    const resultat =
      JSON.parse(texte);

    if (
      !resultat.sous_questions ||
      !Array.isArray(resultat.sous_questions)
    ) {
      throw new Error(
        'Structure JSON invalide'
      );
    }

    return resultat;

  } catch (error) {

    console.error(
      `[Agent1] Erreur tentative ${tentative}:`,
      error.message
    );

    if (tentative < MAX_TENTATIVES) {

      console.log(
        `[Agent1] Nouvelle tentative...`
      );

      return analyser(
        affirmation,
        tentative + 1
      );
    }

    return {
      affirmation_originale:
        affirmation,

      sous_questions: [
        affirmation
      ],

      mots_cles:
        affirmation
          .split(' ')
          .slice(0, 5),

      erreur: true,
    };
  }
}

export default { analyser };