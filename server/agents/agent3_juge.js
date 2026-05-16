// ══════════════════════════════════════════════════════════
// AGENT 3 — JUGE
// CORRECTIFS :
//   1. Utilise le champ `polarity` fourni par Agent 2
//      pour classer chaque preuve POUR / CONTRE sans LLM
//   2. Détection de contradiction structurelle
//   3. Score de confiance adapté au mode (Gemini / fallback)
//   [FIX] analyserPreuves : les preuves neutres à score ≥ 0.60
//         sont désormais comptées POUR par défaut.
//         Avant ce fix : 0 POUR + 0 CONTRE → INCERTAIN systématique
//         même avec 11 sources pertinentes (Climat.be, WMO, Canada.ca…)
//   [FIX] verdictLocal : accepte nPour ≥ 2 (était ≥ 3) pour VRAI,
//         et utilise le score moyen comme dernier recours
// ══════════════════════════════════════════════════════════

import axios from 'axios';

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

const SEUIL_PERTINENCE_JUGE = 0.40;

// ─────────────────────────────────────────────────────────
// FILTRAGE
// ─────────────────────────────────────────────────────────

const URL_PARASITES = [
  'dictionnaire', 'wiktionary', 'spotify', 'instagram',
  'wordhippo', 'reverso', 'vocabulix', 'mots-croises',
  'youtube.com/@', 'lerobert', 'collinsdictionary', 'fsolver',
  'wordreference',
];

function filtrerPreuves(preuves = []) {
  const filtrees = preuves.filter(preuve => {
    const url     = (preuve.url     || '').toLowerCase();
    const extrait = (preuve.extrait || '');

    if (URL_PARASITES.some(m => url.includes(m))) {
      console.log(`[Agent 3] Rejeté (URL parasite) : ${url}`);
      return false;
    }

    if (extrait.length < 30) {
      console.log(`[Agent 3] Rejeté (extrait court)`);
      return false;
    }

    if (Number(preuve.score_pertinence ?? 0) < SEUIL_PERTINENCE_JUGE) {
      console.log(`[Agent 3] Rejeté (score ${Number(preuve.score_pertinence).toFixed(2)}) : ${preuve.source}`);
      return false;
    }

    return true;
  });

  console.log(`\n[Agent 3] Filtrage : ${preuves.length} → ${filtrees.length} preuves retenues`);
  return filtrees;
}

// ─────────────────────────────────────────────────────────
// MOTS-CLÉS DE POLARITÉ LEXICALE (fallback si polarity absente)
// ─────────────────────────────────────────────────────────

const MOTS_CONTRE = [
  'faux', 'infirmé', 'démenti', 'réfuté', 'incorrect',
  "n'est pas", 'ne sont pas', 'ne cause pas', 'ne causent pas',
  'aucune preuve', 'mythe', 'erroné', 'rumeur',
];

const MOTS_POUR = [
  'confirmé', 'prouvé', 'démontré', 'vérifié',
  'selon les experts', 'étude montre', 'recherche confirme',
  'officiel', 'reconnu', 'certifié',
];

// ─────────────────────────────────────────────────────────
// ★ ANALYSE PAR POLARITÉ — VERSION CORRIGÉE
//
// [FIX PRINCIPAL] Avant ce correctif :
//   - polarity = 'neutre' pour toutes les preuves (fallback Agent 2)
//   - MOTS_POUR ne matchent pas les snippets scientifiques
//   - Résultat : 0 POUR + 0 CONTRE → INCERTAIN
//
// Après ce correctif :
//   - Les preuves avec polarity='pour' (calculée par Agent 2
//     grâce aux CONFIRMATEURS) → arguments_pour
//   - Les preuves encore neutres mais score ≥ 0.60 → POUR par défaut
//     (logique : si très pertinente et sans contradiction → confirme)
//   - Preuves entre 0.40 et 0.60, neutres → ignorées
// ─────────────────────────────────────────────────────────

function analyserPreuves(preuves) {

  const arguments_pour   = [];
  const arguments_contre = [];
  const sources_citees   = [];
  let   nbFallback       = 0;

  for (const preuve of preuves) {

    if (preuve.url) sources_citees.push(preuve.url);
    if (!preuve.extrait) continue;

    const texte = preuve.extrait.toLowerCase();
    const score = Number(preuve.score_pertinence ?? 0);
    if (preuve.scoring_fallback) nbFallback++;

    // 1. Priorité absolue à la polarity calculée par Agent 2
    if (preuve.polarity === 'contre') {
      arguments_contre.push(preuve.extrait);
      continue;
    }

    if (preuve.polarity === 'pour') {
      arguments_pour.push(preuve.extrait);
      continue;
    }

    // 2. Détection lexicale pour les preuves sans polarity claire
    if (MOTS_CONTRE.some(m => texte.includes(m))) {
      arguments_contre.push(preuve.extrait);
      continue;
    }

    if (MOTS_POUR.some(m => texte.includes(m))) {
      arguments_pour.push(preuve.extrait);
      continue;
    }

    // ★ 3. FIX CRITIQUE : preuves neutres à score élevé → POUR par défaut
    //
    // Raisonnement : si Agent 2 a jugé cette preuve très pertinente
    // (score ≥ 0.60) mais n'a pas pu déterminer la polarité avec
    // certitude, on considère qu'elle CONFIRME l'affirmation.
    // L'absence de contradiction dans une source pertinente = confirmation.
    //
    // Exemples typiques qui passent ici :
    //   - "Le CO2 est le gaz à effet de serre le plus important" (WMO, score 0.67)
    //   - "De tous les GES, le CO₂ est le principal responsable" (Climat.be, score 1.0)
    //   - "Le CO2 représente 66% du forçage radiatif" (Canada.ca, score 0.67)
    if (score >= 0.60) {
      arguments_pour.push(preuve.extrait);
      continue;
    }

    // 4. Score entre 0.40 et 0.59, neutre → vraiment indéterminé, on ignore
    //    (ne contribue ni POUR ni CONTRE au verdict)
  }

  return {
    arguments_pour:   [...new Set(arguments_pour)].slice(0, 5),
    arguments_contre: [...new Set(arguments_contre)].slice(0, 5),
    sources_citees:   [...new Set(sources_citees)].slice(0, 15),
    // true si la majorité des preuves vient du scoring fallback
    scoring_via_fallback: nbFallback > 0 && nbFallback >= preuves.length / 2,
  };
}

// ─────────────────────────────────────────────────────────
// GEMINI — prompt enrichi avec structure + polarités
// ─────────────────────────────────────────────────────────

async function analyseGemini(affirmation, criteres, structure, preuves) {

  const structureInfo = structure
    ? `Structure détectée : "${structure.type}" — sujet="${structure.sujet}", objet="${structure.objet}"`
    : 'Structure non reconnue — analyse libre';

  const prompt = `
Tu es un expert en fact-checking.

## Affirmation à vérifier
"${affirmation}"

## ${structureInfo}

## Critères de pertinence
${criteres}

## Preuves (avec polarité pré-calculée)
${preuves.map((p, i) => `
[${i + 1}] Source: ${p.source} | Score: ${Number(p.score_pertinence).toFixed(2)} | Polarité estimée: ${p.polarity || '?'}
Extrait: ${p.extrait.slice(0, 350)}
`).join('\n')}

## Instructions
1. Vérifie si la polarité estimée est correcte pour chaque preuve
2. Note toute preuve qui contredit DIRECTEMENT l'affirmation
3. Rends un verdict basé uniquement sur les preuves pertinentes

Retourne UNIQUEMENT ce JSON valide :
{
  "verdict": "VRAI|FAUX|INCERTAIN",
  "score_fiabilite": 0,
  "biais_detectes": [],
  "recommandation": ""
}
`;

  const response = await axios.post(GEMINI_URL, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 800 },
  });

  let texte = response.data.candidates[0].content.parts[0].text;
  texte = texte.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(texte);
}

// ─────────────────────────────────────────────────────────
// ★ VERDICT LOCAL — VERSION CORRIGÉE
//
// [FIX] nPour ≥ 2 (était ≥ 3) pour déclencher VRAI
// [FIX] Dernier recours : score moyen des preuves retenues
//       si aucun argument n'est classé POUR ou CONTRE
// ─────────────────────────────────────────────────────────

function verdictLocal(analyseLocale, vieFallback, preuves) {

  const nPour   = analyseLocale.arguments_pour.length;
  const nContre = analyseLocale.arguments_contre.length;

  console.log(`\n[Agent 3] Arguments POUR: ${nPour} | CONTRE: ${nContre} | Fallback: ${vieFallback}`);

  // Confiance légèrement réduite si tout vient du fallback
  const baseScore = vieFallback ? 60 : 75;

  // FAUX : au moins 2 sources contredisent, plus que les confirmations
  if (nContre >= 2 && nContre > nPour) {
    return { verdict: 'FAUX', score: baseScore + 10 };
  }

  // VRAI : au moins 2 sources confirment, plus que les contradictions
  if (nPour >= 2 && nPour > nContre) {
    const bonus = nPour >= 4 ? 15 : 5;
    return { verdict: 'VRAI', score: baseScore + bonus };
  }

  // INCERTAIN : sources contradictoires présentes
  if (nContre >= 1 && nPour >= 1) {
    return { verdict: 'INCERTAIN', score: baseScore - 15 };
  }

  // ★ Dernier recours : si des preuves ont été retenues mais
  // aucune n'a pu être classée (cas edge), on regarde le score moyen
  if (preuves && preuves.length >= 3) {
    const scoreMoyen = preuves.reduce((s, p) =>
      s + Number(p.score_pertinence), 0) / preuves.length;

    if (scoreMoyen >= 0.65) {
      return { verdict: 'VRAI',      score: baseScore - 10 };
    }
    if (scoreMoyen >= 0.50) {
      return { verdict: 'INCERTAIN', score: 55 };
    }
  }

  return { verdict: 'INCERTAIN', score: 40 };
}

// ─────────────────────────────────────────────────────────
// FONCTION PRINCIPALE
// ─────────────────────────────────────────────────────────

async function juger(preuvesAgent2) {

  try {

    console.log('\n===== AGENT 3 =====');

    const affirmation = preuvesAgent2.affirmation;
    const criteres    = preuvesAgent2.criteres_pertinence ||
      `Une preuve pertinente doit traiter directement de : ${affirmation}`;
    const structure   = preuvesAgent2.structure_claim || null;

    let preuves = preuvesAgent2.resultats || [];
    preuves     = filtrerPreuves(preuves);

    if (preuves.length === 0) {
      return {
        affirmation,
        verdict:          'INCERTAIN',
        score_fiabilite:  25,
        arguments_pour:   [],
        arguments_contre: [],
        biais_detectes:   ['Aucune preuve pertinente trouvée'],
        sources_citees:   [],
        recommandation:   'Aucune source pertinente trouvée. Vérifiez manuellement.',
      };
    }

    // ─── Analyse par polarité (exploite le travail de l'Agent 2) ──
    const analyseLocale = analyserPreuves(preuves);

    console.log('[Agent 3] Arguments POUR  :', analyseLocale.arguments_pour.length);
    console.log('[Agent 3] Arguments CONTRE:', analyseLocale.arguments_contre.length);

    // ─── Tentative Gemini ──────────────────────────────────
    let analyseIA = null;
    try {
      analyseIA = await analyseGemini(affirmation, criteres, structure, preuves);
      console.log('[Agent 3] Gemini OK :', analyseIA?.verdict);
    } catch (e) {
      console.warn('[Agent 3] Gemini non disponible :', e.message);
    }

    // ─── Verdict final ─────────────────────────────────────
    let verdict, score;

    if (analyseIA?.verdict) {
      // Gemini disponible → on lui fait confiance
      verdict = analyseIA.verdict;
      score   = analyseIA.score_fiabilite ?? 70;
    } else {
      // Fallback local basé sur les polarités de l'Agent 2
      const local = verdictLocal(
        analyseLocale,
        analyseLocale.scoring_via_fallback,
        preuves   // ★ passage des preuves pour le calcul du score moyen
      );
      verdict = local.verdict;
      score   = local.score;
    }

    return {
      affirmation,
      verdict,
      score_fiabilite:  score,
      arguments_pour:   analyseLocale.arguments_pour,
      arguments_contre: analyseLocale.arguments_contre,
      biais_detectes:   analyseIA?.biais_detectes ?? [],
      sources_citees:   analyseLocale.sources_citees,
      recommandation:
        analyseIA?.recommandation ||
        (analyseLocale.scoring_via_fallback
          ? 'Analyse en mode dégradé (API Gemini indisponible). Résultat basé sur analyse sémantique des sources.'
          : 'Analyse terminée. Consultez les sources citées.'),
    };

  } catch (error) {

    console.error('[AGENT 3 ERROR]', error.message);
    return {
      affirmation:      preuvesAgent2.affirmation,
      verdict:          'INCERTAIN',
      score_fiabilite:  50,
      arguments_pour:   [],
      arguments_contre: [],
      biais_detectes:   ['Erreur interne'],
      sources_citees:   [],
      recommandation:   "Erreur lors de l'analyse. Vérifiez manuellement.",
    };
  }
}

export default { juger };