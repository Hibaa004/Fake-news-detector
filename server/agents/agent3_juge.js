
import groq from '../groqClient.js';
const SEUIL_PERTINENCE_NORMAL   = 0.20;
const SEUIL_PERTINENCE_FALLBACK = 0.10;

// ─────────────────────────────────────────────────────────
// URLs parasites
// ─────────────────────────────────────────────────────────
const URL_PARASITES = [
  'dictionnaire', 'wiktionary', 'spotify', 'instagram',
  'wordhippo', 'reverso', 'vocabulix', 'mots-croises',
  'youtube.com/@', 'lerobert', 'collinsdictionary',
  'fsolver', 'wordreference', 'larousse.fr/definitions',
];

// ─────────────────────────────────────────────────────────
// Indicateurs lexicaux génériques
// ─────────────────────────────────────────────────────────
const MOTS_CONTRE = [
  'faux', 'infirmé', 'démenti', 'réfuté', 'incorrect', 'inexact',
  "n'est pas", 'ne sont pas', 'aucune preuve', 'mythe', 'erroné',
  'rumeur', 'désinformation', 'fake', 'mensonge', 'contredit',
  'en réalité', 'contrairement', 'à tort',
];

const MOTS_POUR = [
  'confirmé', 'prouvé', 'démontré', 'vérifié', 'officiel', 'reconnu',
  'vrai', 'exact', 'correct', 'avéré', 'attesté', 'établi',
  'effectivement', 'bien que', 'selon les données',
];

// ─────────────────────────────────────────────────────────
// Normalisation
// ─────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  'le','la','les','un','une','des','de','du','d',
  'et','est','en','au','aux','ce','se','sa','son',
  'que','qui','ne','pas','plus','par','sur','dans',
  'il','elle','ils','elles','ou','où','à','y','a',
  'cette','cet','leur','leurs','mon','ton','notre','votre',
]);

function normaliserTexte(texte) {
  return texte
    .toLowerCase()
    .replace(/[''`´]/g, ' ')
    .replace(/[^a-zàâçéèêëîïôûùüÿñæœ0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokeniserSignificatifs(texte) {
  return normaliserTexte(texte)
    .split(' ')
    .filter(m => m.length > 2 && !STOP_WORDS.has(m));
}

// ─────────────────────────────────────────────────────────
// Filtrage des preuves
// Seuil adaptatif si tout est passé en fallback
// ─────────────────────────────────────────────────────────
function filtrerPreuves(preuves = []) {
  const enFallback  = preuves.every(p => p.scoring_fallback);
  const seuil       = enFallback ? SEUIL_PERTINENCE_FALLBACK : SEUIL_PERTINENCE_NORMAL;

  const filtrees = preuves.filter(preuve => {
    const url     = (preuve.url     || '').toLowerCase();
    const extrait = (preuve.extrait || '');
    if (URL_PARASITES.some(m => url.includes(m))) return false;
    if (extrait.length < 30)                        return false;
    const score = Number(preuve.score_pertinence ?? 0);

if (
  score < seuil &&
  preuve.polarity !== 'contre'
) {
  return false;
}
    return true;
  });

  console.log(`\n[Agent3] Filtrage : ${preuves.length} → ${filtrees.length} preuves retenues`);
  if (enFallback) console.log('[Agent3] ℹ Mode fallback : seuil abaissé à', seuil);
  return filtrees;
}

// ─────────────────────────────────────────────────────────
// Vérification directe via negation_attendue
// Dernier filet de sécurité si tout le reste est neutre
// ─────────────────────────────────────────────────────────
function negationPresenteDansExtrait(negationAttendue, extrait) {
  if (!negationAttendue || !extrait) return false;
  const negTokens  = tokeniserSignificatifs(negationAttendue);
  const extTokens  = tokeniserSignificatifs(extrait);
  if (negTokens.length === 0) return false;

  let matches = 0;
  for (const nt of negTokens) {
    for (const et of extTokens) {
      const len = Math.min(6, Math.min(nt.length, et.length));
      if (len >= 4 && nt.slice(0, len) === et.slice(0, len)) {
        matches++;
        break;
      }
    }
  }
  return matches >= Math.max(1, Math.floor(negTokens.length * 0.4));
}

// ─────────────────────────────────────────────────────────
// ★ Analyse locale des preuves
//
// Ordre de priorité :
// 1. polarity Agent 2 = 'contre'        → CONTRE
// 2. polarity Agent 2 = 'pour'          → POUR
// 3. negation_attendue dans l'extrait   → CONTRE
// 4. Mots-clés lexicaux génériques      → POUR ou CONTRE
// 5. Neutre                             → ignoré
// ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────
// ★ Analyse locale ROBUSTE des preuves
// ─────────────────────────────────────────────────────────
function analyserPreuves(
  preuves,
  negationAttendue = '',
  structure = {}
) {
  const arguments_pour   = [];
  const arguments_contre = [];
  const sources_citees   = [];

  let nbFallback = 0;

  const sujet = normaliserTexte(structure?.sujet || '');
  const predicat = normaliserTexte(
    structure?.predicat ||
    structure?.role_revendique ||
    ''
  );

  for (const preuve of preuves) {

    if (preuve.url) {
      sources_citees.push(preuve.url);
    }

    if (!preuve.extrait) continue;

    const texte = normaliserTexte(preuve.extrait);

    if (preuve.scoring_fallback) {
      nbFallback++;
    }

    // =====================================================
    // 1. PRIORITÉ : polarity venant Agent2
    // =====================================================

    if (preuve.polarity === 'contre') {

      console.log(
        `[Agent3] → CONTRE (polarity Agent2) : ${preuve.source}`
      );

      arguments_contre.push(preuve.extrait);
      continue;
    }

    if (preuve.polarity === 'pour') {

      console.log(
        `[Agent3] → POUR (polarity Agent2) : ${preuve.source}`
      );

      arguments_pour.push(preuve.extrait);
      continue;
    }

    // =====================================================
    // 2. Détection locale POUR
    // =====================================================

    const sujetPresent =
      sujet &&
      texte.includes(sujet);

    const predicatTokens =
      tokeniserSignificatifs(predicat);

    const predicatPresent =
      predicatTokens.length > 0 &&
      predicatTokens.some(t => texte.includes(t));

    if (sujetPresent && predicatPresent) {

      console.log(
        `[Agent3] → POUR (détection locale) : ${preuve.source}`
      );

      arguments_pour.push(preuve.extrait);
      continue;
    }

    // =====================================================
    // 3. negation_attendue
    // =====================================================

    if (
      negationAttendue &&
      negationPresenteDansExtrait(
        negationAttendue,
        preuve.extrait
      )
    ) {

      console.log(
        `[Agent3] → CONTRE (negation_attendue) : ${preuve.source}`
      );

      arguments_contre.push(preuve.extrait);
      continue;
    }

    // =====================================================
    // 4. Lexical CONTRE
    // =====================================================

    if (MOTS_CONTRE.some(m => texte.includes(m))) {

      console.log(
        `[Agent3] → CONTRE (lexical) : ${preuve.source}`
      );

      arguments_contre.push(preuve.extrait);
      continue;
    }

    // =====================================================
    // 5. Lexical POUR
    // =====================================================

    if (MOTS_POUR.some(m => texte.includes(m))) {

      console.log(
        `[Agent3] → POUR (lexical) : ${preuve.source}`
      );

      arguments_pour.push(preuve.extrait);
      continue;
    }

    console.log(
      `[Agent3] → NEUTRE : ${preuve.source}`
    );
  }

  return {
    arguments_pour:
      [...new Set(arguments_pour)].slice(0, 5),

    arguments_contre:
      [...new Set(arguments_contre)].slice(0, 5),

    sources_citees:
      [...new Set(sources_citees)].slice(0, 15),

    scoring_via_fallback:
      nbFallback > 0 &&
      nbFallback >= preuves.length / 2,
  };
}
// ─────────────────────────────────────────────────────────
// Analyse Gemini — prompt adapté au type d'affirmation
// ─────────────────────────────────────────────────────────
async function analyseGemini(affirmation, criteres, typeAffirmation, predicat, negationAttendue, preuves) {
  const instructionsParType = {
    identite:    `Si un extrait associe le sujet à un rôle/titre/qualité DIFFÉRENT de "${predicat}" → verdict FAUX.`,
    causalite:   `Si un extrait attribue la cause à un facteur différent ou nie le lien → FAUX.`,
    statistique: `Si un extrait donne un chiffre/pourcentage différent → FAUX.`,
    temporelle:  `Si un extrait donne une date/période différente → FAUX.`,
    comparative: `Si un extrait inverse la comparaison → FAUX.`,
    citation:    `Si un extrait dément la citation ou l'attribue à quelqu'un d'autre → FAUX.`,
    geographique:`Si un extrait localise le sujet ailleurs → FAUX.`,
    scientifique:`Si des études contredisent le claim ou l'absence de consensus est notée → FAUX.`,
    autre:       `Applique ton raisonnement général de fact-checking.`,
  };

  const instruction = instructionsParType[typeAffirmation] || instructionsParType.autre;

  const prompt = `
Tu es un expert en fact-checking.

Affirmation : "${affirmation}"
Type : "${typeAffirmation}"
Prédicat revendiqué : "${predicat}"
Ce qui contredirait l'affirmation : "${negationAttendue || 'à déterminer'}"
Critères : ${criteres}

RÈGLE CRITIQUE POUR CE TYPE :
${instruction}

RÈGLE GÉNÉRALE :
Une seule preuve solide et contradictoire l'emporte sur plusieurs preuves vagues en faveur.

Preuves :
${preuves.map((p, i) => `
[${i + 1}] Source: ${p.source} | Score: ${Number(p.score_pertinence).toFixed(2)} | Polarité: ${p.polarity || 'neutre'}
${p.extrait.slice(0, 400)}
`).join('\n')}

Retourne UNIQUEMENT ce JSON :
{
  "verdict": "VRAI|FAUX|INCERTAIN",
  "score_fiabilite": <entier 0-100>,
  "biais_detectes": ["<biais 1>"],
  "recommandation": "<conseil court>"
}
`;

 const completion =
  await groq.chat.completions.create({

    model: "llama-3.3-70b-versatile",

    messages: [
      {
        role: "user",
        content: prompt
      }
    ],

    temperature: 0.1,
    max_tokens: 800,
  });

let texte =
  completion.choices[0].message.content;
  texte = texte.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(texte);
}

// ─────────────────────────────────────────────────────────
// Verdict local (fallback si Gemini indisponible)
// ─────────────────────────────────────────────────────────
function verdictLocal(analyseLocale) {
  const nPour   = analyseLocale.arguments_pour.length;
  const nContre = analyseLocale.arguments_contre.length;

  console.log(`\n[Agent3] Verdict local — POUR: ${nPour} | CONTRE: ${nContre}`);

  if (nContre >= 1 && nContre >= nPour) return { verdict: 'FAUX',      score: 80 };
  if (nPour  >= 2 && nContre === 0)    return { verdict: 'VRAI',      score: 80 };
  if (nPour  === 1 && nContre === 0)   return { verdict: 'INCERTAIN', score: 55 };
  if (nPour  >= 1 && nContre >= 1)     return { verdict: 'INCERTAIN', score: 50 };
  return                                      { verdict: 'INCERTAIN', score: 30 };
}

// ─────────────────────────────────────────────────────────
// Fonction principale
// ─────────────────────────────────────────────────────────
async function juger(preuvesAgent2) {
  try {
    console.log('\n═══════════════════════════════════════════');
    console.log('[Agent3] Démarrage du jugement');

    const affirmation      = preuvesAgent2.affirmation;
    const criteres         = preuvesAgent2.criteres_pertinence ||
      `Une preuve pertinente traite directement de : ${affirmation}`;
    const structure        = preuvesAgent2.structure_claim || null;
    const typeAffirmation  = preuvesAgent2.type_affirmation || 'autre';
    const negationAttendue = preuvesAgent2.negation_attendue || '';
    const predicat         = structure?.predicat
      || structure?.role_revendique
      || preuvesAgent2.role_revendique
      || '';

    console.log('[Agent3] Affirmation     :', affirmation);
    console.log('[Agent3] Type            :', typeAffirmation);
    console.log('[Agent3] Prédicat        :', predicat || 'non précisé');
    console.log('[Agent3] Négation att.   :', negationAttendue || 'non précisée');

    let preuves = preuvesAgent2.resultats || [];
    preuves = filtrerPreuves(preuves);
    console.log('\n===== PREUVES APRES FILTRAGE =====');

preuves.forEach((p, i) => {
  console.log(
    `[${i}] score=${p.score_pertinence} polarity=${p.polarity}`
  );
  console.log(p.extrait?.slice(0, 150));
});

    if (preuves.length === 0) {
      return {
        affirmation,
        type_affirmation:  typeAffirmation,
        verdict: 'INCERTAIN',
        score_fiabilite: 25,
        arguments_pour: [],
        arguments_contre: [],
        biais_detectes: ['Aucune preuve pertinente trouvée'],
        sources_citees: [],
        recommandation: 'Aucune source pertinente trouvée. Vérifiez manuellement.',
      };
    }

    const analyseLocale = analyserPreuves(
  preuves,
  negationAttendue,
  structure
);

    console.log('[Agent3] Arguments POUR  :', analyseLocale.arguments_pour.length);
    console.log('[Agent3] Arguments CONTRE:', analyseLocale.arguments_contre.length);

    let analyseIA = null;
    try {
      analyseIA = await analyseGemini(
        affirmation, criteres, typeAffirmation, predicat, negationAttendue, preuves
      );
      console.log('[Agent3] ✅ Groq OK → verdict:', analyseIA?.verdict);
    } catch (e) {
      console.warn('[Agent3] ⚠ Groq indisponible :', e.message, '→ verdict local');
    }

    // ── Verdict final ────────────────────────────────────
    let verdict, score;

   if (analyseIA?.verdict) {

  const nbPour =
    analyseLocale.arguments_pour.length;

  const nbContre =
    analyseLocale.arguments_contre.length;

  // =====================================================
  // Protection anti inversion logique
  // =====================================================

  // Beaucoup de POUR et presque aucun CONTRE
  // => impossible que ce soit FAUX

  if (
    analyseIA.verdict === 'FAUX' &&
    nbPour >= 3 &&
    nbContre === 0
  ) {

    console.warn(
      '[Agent3] ⚡ Override FAUX → VRAI (preuves positives massives)'
    );

    verdict = 'VRAI';
    score   = 90;
  }

  // Beaucoup de CONTRE et aucun POUR
  // => impossible que ce soit VRAI

  else if (
    analyseIA.verdict === 'VRAI' &&
    nbContre >= 3 &&
    nbPour === 0
  ) {

    console.warn(
      '[Agent3] ⚡ Override VRAI → FAUX (contradictions massives)'
    );

    verdict = 'FAUX';
    score   = 85;
  }

  else {

    verdict =
      analyseIA.verdict;

    score =
      analyseIA.score_fiabilite ?? 70;
  }

}

    console.log(`\n[Agent3] ★ VERDICT FINAL : ${verdict} (${score}%)`);

    return {
      affirmation,
      type_affirmation:  typeAffirmation,
      verdict,
      score_fiabilite:   score,
      arguments_pour:    analyseLocale.arguments_pour,
      arguments_contre:  analyseLocale.arguments_contre,
      biais_detectes:    analyseIA?.biais_detectes ?? [],
      sources_citees:    analyseLocale.sources_citees,
      recommandation:
        analyseIA?.recommandation ||
        (analyseLocale.scoring_via_fallback
          ? 'Analyse en mode fallback — résultat à vérifier manuellement.'
          : 'Analyse terminée.'),
    };

  } catch (error) {
    console.error('[AGENT 3 ERROR]', error.message);
    return {
      affirmation: preuvesAgent2?.affirmation || '',
      verdict: 'INCERTAIN',
      score_fiabilite: 50,
      arguments_pour: [],
      arguments_contre: [],
      biais_detectes: ["Erreur interne lors de l'analyse"],
      sources_citees: [],
      recommandation: "Erreur lors de l'analyse. Vérifiez manuellement.",
    };
  }
}

export default { juger };