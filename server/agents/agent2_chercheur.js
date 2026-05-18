// ══════════════════════════════════════════════════════════
// AGENT 2 — CHERCHEUR  (FALLBACK ROBUSTE)
//
// PROBLÈME CORRIGÉ :
// En mode fallback (Gemini KO), les snippets contenant
// "premier ministre" face au claim "roi" étaient classés
// NEUTRE car negation_attendue était vide.
//
// CORRECTIFS :
// ✅ Utilise negation_attendue de l'Agent 1 (maintenant remplie)
// ✅ Détection dynamique : si le sujet est présent dans l'extrait
//    MAIS est associé à un AUTRE prédicat que celui revendiqué → CONTRE
// ✅ Indicateurs génériques de contradiction conservés
// ✅ Scoring Gemini inchangé (toujours prioritaire quand disponible)
// ══════════════════════════════════════════════════════════

import axios from 'axios';

const GEMINI_EMBED_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`;

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

const QDRANT_URL  = process.env.QDRANT_URL        || 'http://localhost:6333';
const COLLECTION  = process.env.QDRANT_COLLECTION || 'fake_news_detector';
const SCORE_THRESHOLD  = 0.50;
const TOP_K            = 5;
const SEUIL_PERTINENCE = 0.30;

// ─────────────────────────────────────────────────────────
// Stop words
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
// Indicateurs génériques de polarité
// ─────────────────────────────────────────────────────────
const INDICATEURS_POUR = [
  'confirmé', 'prouvé', 'vérifié', 'démontré', 'officiel', 'reconnu',
  'vrai', 'exact', 'correct', 'avéré', 'attesté', 'établi',
  'effectivement', 'bien que', 'selon les données',
];

const INDICATEURS_CONTRE = [
  'faux', 'infirmé', 'démenti', 'réfuté', 'incorrect', 'inexact',
  "n'est pas", 'ne sont pas', 'aucune preuve', 'mythe', 'erroné',
  'rumeur', 'désinformation', 'fake', 'mensonge', 'contredit',
  'en réalité', 'contrairement', 'à tort',
];

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

function tokeniserSignificatifs(texte) {
  return normaliserTexte(texte)
    .split(' ')
    .filter(m => m.length > 2 && !STOP_WORDS.has(m));
}

// ─────────────────────────────────────────────────────────
// Fuzzy matching — tolérance aux variantes morphologiques
// ─────────────────────────────────────────────────────────
function motsMatchent(a, b, prefixLen = 5) {
  if (a === b) return true;
  const len = Math.min(prefixLen, Math.min(a.length, b.length));
  return len >= 4 && a.slice(0, len) === b.slice(0, len);
}

// ─────────────────────────────────────────────────────────
// ★ DÉTECTION DYNAMIQUE DE CONTRADICTION (sans Gemini)
//
// Principe : si le sujet du claim apparaît dans l'extrait
// ET que l'extrait lui attribue un prédicat DIFFÉRENT du claim,
// alors l'extrait CONTREDIT le claim.
//
// Exemples :
//   claim "Akhannouch est roi" + extrait "premier ministre Akhannouch"
//     → sujet présent + rôle différent → CONTRE
//   claim "CO2 cause le réchauffement" + extrait "vapeur d'eau est la cause principale"
//     → sujet absent mais négation dans extrait → détecté par negation_attendue
// ─────────────────────────────────────────────────────────
function detecterContradictionDynamique(sujet, predicat, extrait) {
  if (!sujet || !predicat || !extrait) return false;

  const sujetNorm   = normaliserTexte(sujet);
  const predicatNorm= normaliserTexte(predicat);
  const extraitNorm = normaliserTexte(extrait);

  // Le sujet doit être mentionné dans l'extrait (fuzzy)
  const sujetTokens   = tokeniserSignificatifs(sujetNorm);
  const extraitTokens = tokeniserSignificatifs(extraitNorm);

  const sujetMentionne = sujetTokens.length > 0 && sujetTokens.some(st =>
    extraitTokens.some(et => motsMatchent(st, et, 6))
  );

  if (!sujetMentionne) return false;

  // Extraire le "terme clé" du prédicat (dernier mot significatif, souvent le rôle)
  const predicatTokens = tokeniserSignificatifs(predicatNorm);
  if (predicatTokens.length === 0) return false;

  // Le terme revendiqué est-il présent dans l'extrait ?
  const ROLE_WORDS = [
  'roi','reine','président',
  'premier','ministre',
  'chef','directeur','pdg'
];

const termeClaim =
  predicatTokens.find(t => ROLE_WORDS.includes(t))
  || predicatTokens[0];
  const claimPresent = extraitTokens.some(et => motsMatchent(termeClaim, et, 5));

  // Si le terme du claim est présent dans l'extrait → pas de contradiction sur ce critère
  if (claimPresent) return false;

  // Le terme du claim est ABSENT mais le sujet est présent.
  // Vérifions si l'extrait attribue explicitement un rôle/attribut au sujet.
  // Patterns d'attribution : "sujet est X", "X sujet", "sujet, X"
  const patronsAttribution = [
    // "le premier ministre Akhannouch"
    new RegExp(`(?:premier ministre|chef du gouvernement|président|ministre|directeur|fondateur|ceo|pdg)\\s+${sujetTokens[sujetTokens.length - 1]}`, 'i'),
    // "Akhannouch est premier ministre"
    new RegExp(`${sujetTokens[sujetTokens.length - 1]}\\s+est\\s+(?:le|la|un|une)?\\s*(?:premier ministre|chef du gouvernement|président|ministre)`, 'i'),
    // "Akhannouch, premier ministre"
    new RegExp(`${sujetTokens[sujetTokens.length - 1]}[,\\s]+(?:premier ministre|chef du gouvernement)`, 'i'),
  ];

  const attributionTrouvee = patronsAttribution.some(re => re.test(extraitNorm));

  if (attributionTrouvee) {
    console.log(`[Agent2] ⚡ Contradiction dynamique : "${termeClaim}" absent, autre rôle attribué à "${sujet}"`);
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────
// ★ Scoring fallback local — robuste sans LLM
//
// Priorités :
// 1. negation_attendue présente dans l'extrait → CONTRE
// 2. Contradiction dynamique sujet + autre prédicat → CONTRE
// 3. Indicateurs génériques de polarité
// 4. Score de chevauchement lexical pur
// ─────────────────────────────────────────────────────────
function scoreGeneriqueLocal(affirmation, extrait, negationAttendue, structure) {
  const motsAff     = tokeniserSignificatifs(affirmation);
  const motsExtrait = tokeniserSignificatifs(extrait);
  const extraitLow  = normaliserTexte(extrait);

  // Score de couverture lexicale
  let matches = 0;
  for (const ma of motsAff) {
    for (const me of motsExtrait) {
      if (motsMatchent(ma, me)) { matches++; break; }
    }
  }
  const score = motsAff.length > 0 ? Math.max(matches / motsAff.length, 0.25) : 0.25;

  // ── Priorité 1 : negation_attendue → CONTRE ──────────
  if (negationAttendue) {
    const negTokens   = tokeniserSignificatifs(negationAttendue);
    const negMatches  = negTokens.filter(nt =>
      motsExtrait.some(me => motsMatchent(nt, me))
    ).length;
    const seuilNeg = Math.max(1, Math.floor(negTokens.length * 0.4));
    if (negMatches >= seuilNeg) {
      console.log(`[Agent2] → CONTRE via negation_attendue (${negMatches}/${negTokens.length} tokens matchés)`);
      return { score, polarity: 'contre' };
    }
  }

  // ── Priorité 2 : contradiction dynamique → CONTRE ────
  if (structure?.sujet && structure?.predicat) {
    if (detecterContradictionDynamique(structure.sujet, structure.predicat, extrait)) {
      return { score, polarity: 'contre' };
    }
  }

  // ── Priorité 3 : indicateurs génériques ──────────────
  const nbPour   = INDICATEURS_POUR.filter(c => extraitLow.includes(c)).length;
  const nbContre = INDICATEURS_CONTRE.filter(c => extraitLow.includes(c)).length;

  let polarity = 'neutre';
  if (nbPour > 0 && nbPour >= nbContre)       polarity = 'pour';
  else if (nbContre > 0 && nbContre > nbPour) polarity = 'contre';

  return { score, polarity };
}

// ─────────────────────────────────────────────────────────
// Embedding
// ─────────────────────────────────────────────────────────
async function embedTexte(texte, taskType = 'RETRIEVAL_QUERY') {
  try {
    const response = await axios.post(GEMINI_EMBED_URL, {
      model: 'models/text-embedding-004',
      content: { parts: [{ text: texte }] },
      taskType,
    });
    return response.data.embedding.values;
  } catch (error) {
    console.error('[EMBED ERROR]', error.response?.data?.error?.message || error.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────
// Sources
// ─────────────────────────────────────────────────────────
async function rechercherQdrant(question) {
  try {
    const vecteur = await embedTexte(question);
    if (!vecteur) return [];
    const response = await axios.post(
      `${QDRANT_URL}/collections/${COLLECTION}/points/search`,
      { vector: vecteur, limit: TOP_K, score_threshold: SCORE_THRESHOLD, with_payload: true }
    );
    console.log('[QDRANT]', response.data.result?.length || 0, 'résultat(s)');
    return (response.data.result || []).map(r => ({
      source: r.payload?.source || 'Qdrant',
      extrait: r.payload?.texte || r.payload?.content || '',
      score_pertinence: Number(r.score || 0),
      url: r.payload?.url || '',
      type: 'qdrant',
    }));
  } catch (error) {
    console.warn('[Agent2] Qdrant ERROR:', error.message);
    return [];
  }
}

async function rechercherNewsAPI(question) {
  try {
    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: { q: question, apiKey: process.env.NEWSAPI_KEY, language: 'fr', sortBy: 'relevancy', pageSize: 5 },
      timeout: 10000,
    });
    console.log('[NewsAPI]', response.data.articles?.length || 0, 'article(s)');
    return (response.data.articles || []).map(a => ({
      source: a.source?.name || 'NewsAPI',
      extrait: a.description || a.title || a.content || '',
      score_pertinence: 0,
      url: a.url || '',
      type: 'newsapi',
    }));
  } catch (error) {
    console.warn('[Agent2] NewsAPI ERROR:', error.message);
    return [];
  }
}

async function rechercherSerpAPI(question) {
  try {
    const response = await axios.get('https://serpapi.com/search.json', {
      params: { q: question, api_key: process.env.SERPAPI_KEY, hl: 'fr', num: 5 },
      timeout: 10000,
    });
    const resultats = response.data.organic_results || [];
    console.log('[SerpAPI]', resultats.length, 'résultat(s)');
    return resultats.map(r => ({
      source: r.source || 'Google',
      extrait: r.snippet || r.title || '',
      score_pertinence: 0,
      url: r.link || '',
      type: 'serpapi',
    }));
  } catch (error) {
    console.warn('[Agent2] SerpAPI ERROR:', error.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────
// Suppression doublons
// ─────────────────────────────────────────────────────────
function supprimerDoublons(preuves) {
  const dejaVu = new Set();
  return preuves.filter(p => {
    const cle = `${p.source}-${p.extrait.slice(0, 60)}`;
    if (dejaVu.has(cle)) return false;
    dejaVu.add(cle);
    return true;
  });
}

// ─────────────────────────────────────────────────────────
// Scoring principal — Gemini d'abord, fallback local ensuite
// ─────────────────────────────────────────────────────────
async function scorerPertinence(affirmation, criteres, preuves, analyseAgent1) {
  if (preuves.length === 0) return [];

  const typeAffirmation  = analyseAgent1?.type_affirmation || 'autre';
  const predicat         = analyseAgent1?.structure?.predicat || analyseAgent1?.structure?.role_revendique || '';
  const negationAttendue = analyseAgent1?.negation_attendue || '';
  const structure        = analyseAgent1?.structure || {};

  const aScorer    = preuves.filter(p => p.type !== 'qdrant');
  const dejaScores = preuves.filter(p => p.type === 'qdrant');
  let resultatsScores = [...dejaScores];

  if (aScorer.length > 0) {
    try {
      // ── Scoring Gemini ──────────────────────────────────
      const prompt = `
Tu es un expert en fact-checking.

Affirmation : "${affirmation}"
Type d'affirmation : "${typeAffirmation}"
Prédicat (ce qui est affirmé) : "${predicat}"
Critères : "${criteres}"
Ce qui contredirait l'affirmation : "${negationAttendue || 'à déterminer par analyse'}"

Pour chaque extrait, donne :
- score (0.0 à 1.0) : pertinence pour vérifier l'affirmation
- polarity : "pour" / "contre" / "neutre"

RÈGLES :
- Si l'extrait contredit le prédicat → "contre" (peu importe le type de claim)
- Si l'extrait confirme le prédicat → "pour"
- Un rôle différent, un chiffre différent, une date différente, une cause différente → "contre"

Extraits :
${aScorer.slice(0, 12).map((p, i) =>
  `[${i}] Source: ${p.source}\n${p.extrait.slice(0, 300)}`
).join('\n\n')}

JSON uniquement :
{ "resultats": [{"score": 0.8, "polarity": "contre"}, ...] }
`;

      const response = await axios.post(GEMINI_URL, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.0, maxOutputTokens: 600 },
      });

      let texte = response.data.candidates[0].content.parts[0].text;
      texte = texte.replace(/```json/g, '').replace(/```/g, '').trim();
      const { resultats } = JSON.parse(texte);

      aScorer.forEach((preuve, i) => {
        const r = resultats[i] || {};
        resultatsScores.push({
          ...preuve,
          score_pertinence: Number(r.score ?? 0.3),
          polarity: r.polarity || 'neutre',
        });
      });

      console.log('[Agent2] ✅ Scoring Gemini OK');

    } catch (e) {
      // ── Fallback scoring local robuste ───────────────────
      console.warn('[Agent2] Scoring Gemini ÉCHEC :', e.message, '→ fallback local');

      aScorer.forEach(preuve => {
        const { score, polarity } = scoreGeneriqueLocal(
          affirmation, preuve.extrait, negationAttendue, structure
        );
        resultatsScores.push({
          ...preuve,
          score_pertinence: score,
          polarity,
          scoring_fallback: true,
        });
      });
    }
  }

  const filtres = resultatsScores.filter(p => p.score_pertinence >= SEUIL_PERTINENCE);

  console.log(`\n[Agent2] ${resultatsScores.length} preuves → ${filtres.length} retenues (seuil ${SEUIL_PERTINENCE})`);
  filtres.forEach(p =>
    console.log(
      `  [${p.score_pertinence.toFixed(2)} | ${(p.polarity || '?').padEnd(7)}]`,
      p.source.slice(0, 28).padEnd(28), '—', p.extrait.slice(0, 70) + '…'
    )
  );

  return filtres.sort((a, b) => b.score_pertinence - a.score_pertinence);
}

// ─────────────────────────────────────────────────────────
// Fonction principale
// ─────────────────────────────────────────────────────────
async function chercher(analyseAgent1) {
  const affirmation      = analyseAgent1.affirmation_originale;
  const sousQuestions    = analyseAgent1.sous_questions || [];
  const motsCles         = analyseAgent1.mots_cles      || [];
  const criteres         = analyseAgent1.criteres_pertinence ||
    `Une preuve pertinente doit traiter directement de : ${affirmation}`;
  const structure        = analyseAgent1.structure       || {};
  const typeAffirmation  = analyseAgent1.type_affirmation || 'autre';
  const negationAttendue = analyseAgent1.negation_attendue || '';

  console.log('\n═══════════════════════════════════════════');
  console.log('[Agent2] Affirmation     :', affirmation);
  console.log('[Agent2] Type            :', typeAffirmation);
  console.log('[Agent2] Prédicat        :', structure.predicat || structure.role_revendique || 'non précisé');
  console.log('[Agent2] Sujet           :', structure.sujet || 'non précisé');
  console.log('[Agent2] Négation att.   :', negationAttendue || 'non précisée');
  console.log('[Agent2] Critères        :', criteres);
  console.log('[Agent2] Mots-clés       :', motsCles);

  let requetes;
  if (analyseAgent1.erreur) {
    requetes = [affirmation];
    console.log('[Agent2] Mode fallback : requête unique');
  } else {
    requetes = [...new Set([affirmation, ...sousQuestions, ...motsCles])]
      .filter(r => r && normaliserTexte(r).length > 3)
      .slice(0, 5);
  }

  console.log('[Agent2] Requêtes :', requetes);

  let preuvesQdrant = [], preuvesNews = [], preuvesSerp = [];

  for (const req of requetes) {
    const [qdrant, news, serp] = await Promise.all([
      rechercherQdrant(req),
      rechercherNewsAPI(req),
      rechercherSerpAPI(req),
    ]);
    preuvesQdrant.push(...qdrant);
    preuvesNews.push(...news);
    preuvesSerp.push(...serp);
  }

  console.log('\n[Agent2] Qdrant  :', preuvesQdrant.length);
  console.log('[Agent2] NewsAPI :', preuvesNews.length);
  console.log('[Agent2] SerpAPI :', preuvesSerp.length);

  let toutesPreuves = supprimerDoublons([
    ...preuvesNews, ...preuvesSerp, ...preuvesQdrant,
  ]);

  toutesPreuves = await scorerPertinence(affirmation, criteres, toutesPreuves, analyseAgent1);

  return {
    affirmation,
    type_affirmation:             typeAffirmation,
    criteres_pertinence:          criteres,
    negation_attendue:            negationAttendue,
    structure_claim:              structure,
    role_revendique:              structure.predicat || structure.role_revendique || '',
    resultats:                    toutesPreuves,
    sources_citees:               [...new Set(toutesPreuves.map(p => p.url).filter(Boolean))],
    alerte_sources_insuffisantes: toutesPreuves.length === 0,
  };
}

export default { chercher };