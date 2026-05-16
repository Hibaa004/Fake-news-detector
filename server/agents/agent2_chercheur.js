// ══════════════════════════════════════════════════════════
// AGENT 2 — CHERCHEUR
// CORRECTIFS :
//   1. Apostrophes gérées avant tokenisation (d'origine → origine)
//   2. Matching fuzzy : comparaison sur les 5 premiers chars
//   3. Score base 0.3 pour les claims génériques quand
//      Gemini est indisponible (évite le 0 résultats)
//   4. Modèle embedding : text-embedding-004 (plus récent)
//   [FIX] En mode fallback (analyseAgent1.erreur = true),
//         on ne lance QUE l'affirmation complète comme requête
//         pour éviter les résultats parasites sur mots isolés
//   [FIX] scoreGeneriqueAvecFuzzy détecte désormais la polarité
//         sémantique (POUR/CONTRE) via listes de mots confirmateurs
//         et nuanceurs — plus de tout-neutre en fallback
// ══════════════════════════════════════════════════════════

import axios from 'axios';

// ─────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────

const GEMINI_EMBED_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`;

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

const QDRANT_URL  = process.env.QDRANT_URL        || 'http://localhost:6333';
const COLLECTION  = process.env.QDRANT_COLLECTION || 'fake_news_detector';

const SCORE_THRESHOLD  = 0.50;
const TOP_K            = 5;
const SEUIL_PERTINENCE = 0.30;   // seuil abaissé : Agent 3 filtre à son tour

// ─────────────────────────────────────────────────────────
// STOP WORDS
// ─────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'le','la','les','un','une','des','de','du',
  'et','est','en','au','aux','ce','se','sa','son',
  'que','qui','ne','pas','plus','par','sur','dans',
  'il','elle','ils','elles','ou','où','à','y','a',
  'cette','cet','leur','leurs','mon','ton','notre','votre',
]);

// ─────────────────────────────────────────────────────────
// Mots indiquant une CONFIRMATION de l'affirmation
// ─────────────────────────────────────────────────────────
const CONFIRMATEURS = [
  'principal', 'principaux', 'plus important', 'le plus important',
  'majoritaire', 'représente', 'responsable', 'contribue', 'essentiel',
  'dominant', 'première place', 'premier rang', '66 %', '64 %',
  '70%', '70 %', '2/3', 'deux tiers', 'confirme', 'prouve', 'démontre',
  'selon les experts', 'étude montre', 'recherche confirme',
  'officiellement', 'reconnu', 'certifié', 'vérifié',
];

// ─────────────────────────────────────────────────────────
// Mots indiquant une NUANCE ou CONTRADICTION
// ─────────────────────────────────────────────────────────
const NUANCEURS = [
  'deuxième', 'second', 'après la vapeur', "vapeur d'eau", 'vapeur eau',
  'mais', 'cependant', 'toutefois', 'en revanche', 'or ',
  'méthane plus', 'plus réchauffant que', 'pouvoir réchauffant',
  'ne cause pas', 'ne provoque pas', 'aucun lien', 'pas de lien',
  'faux', 'infirmé', 'démenti', 'réfuté', 'incorrect', 'mythe', 'erroné',
];

// ─────────────────────────────────────────────────────────
// NORMALISATION (partagée Agent 1 / Agent 2)
// Apostrophes → espaces avant toute chose
// ─────────────────────────────────────────────────────────

function normaliserTexte(texte) {
  return texte
    .toLowerCase()
    .replace(/[''`´]/g, ' ')
    .replace(/[^a-zàâçéèêëîïôûùüÿñæœ\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokeniserSignificatifs(texte) {
  return normaliserTexte(texte)
    .split(' ')
    .filter(m => m.length > 3 && !STOP_WORDS.has(m));
}

// ─────────────────────────────────────────────────────────
// EMBEDDING
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
    console.error('\n[EMBED ERROR]', error.response?.data?.error?.message || error.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────
// SOURCES
// ─────────────────────────────────────────────────────────

async function rechercherQdrant(question) {
  try {
    console.log('\n===== QDRANT SEARCH =====');
    const vecteur = await embedTexte(question);
    if (!vecteur) { console.warn('[QDRANT] Embedding indisponible'); return []; }
    const response = await axios.post(
      `${QDRANT_URL}/collections/${COLLECTION}/points/search`,
      { vector: vecteur, limit: TOP_K, score_threshold: SCORE_THRESHOLD, with_payload: true }
    );
    console.log('Résultats Qdrant :', response.data.result?.length || 0);
    return (response.data.result || []).map(r => ({
      source: r.payload?.source || 'Qdrant',
      extrait: r.payload?.texte || r.payload?.content || r.payload?.affirmation || '',
      score_pertinence: Number(r.score || 0),
      url: r.payload?.url || '',
      type: 'qdrant',
    }));
  } catch (error) {
    console.warn('\n[Agent 2] Qdrant ERROR:', error.response?.data || error.message);
    return [];
  }
}

async function rechercherNewsAPI(question) {
  try {
    console.log('\n===== NEWS API SEARCH =====');
    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: { q: question, apiKey: process.env.NEWSAPI_KEY, language: 'fr', sortBy: 'relevancy', pageSize: 5 },
      timeout: 10000,
    });
    console.log('Nombre articles:', response.data.articles?.length || 0);
    return (response.data.articles || []).map(a => ({
      source: a.source?.name || 'NewsAPI',
      extrait: a.description || a.title || a.content || '',
      score_pertinence: 0,
      url: a.url || '',
      type: 'newsapi',
    }));
  } catch (error) {
    console.warn('\n[Agent 2] NewsAPI ERROR:', error.response?.data || error.message);
    return [];
  }
}

async function rechercherSerpAPI(question) {
  try {
    console.log('\n===== SERP API SEARCH =====');
    const response = await axios.get('https://serpapi.com/search.json', {
      params: { q: question, api_key: process.env.SERPAPI_KEY, hl: 'fr', num: 5 },
      timeout: 10000,
    });
    const resultats = response.data.organic_results || [];
    console.log('Nombre résultats:', resultats.length);
    return resultats.map(r => ({
      source: r.source || 'Google',
      extrait: r.snippet || r.title || '',
      score_pertinence: 0,
      url: r.link || '',
      type: 'serpapi',
    }));
  } catch (error) {
    console.warn('\n[Agent 2] SerpAPI ERROR:', error.response?.data || error.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────
// SUPPRESSION DOUBLONS
// ─────────────────────────────────────────────────────────

function supprimerDoublons(preuves) {
  const dejaVu = new Set();
  return preuves.filter(p => {
    const cle = `${p.source}-${p.extrait}`;
    if (dejaVu.has(cle)) return false;
    dejaVu.add(cle);
    return true;
  });
}

// ─────────────────────────────────────────────────────────
// DÉTECTION DE STRUCTURE
// ─────────────────────────────────────────────────────────

function extraireStructureClaim(affirmation) {
  const aff = normaliserTexte(affirmation);

  // "X est (la) capitale de Y"
  const mCapitale = aff.match(/^(.+?)\s+est\s+(?:la\s+|une\s+)?capitale\s+(?:de\s+(?:la\s+|le\s+|l\s+)?|du\s+)(.+)$/);
  if (mCapitale) return { type: 'capitale', sujet: mCapitale[1].trim(), objet: mCapitale[2].trim() };

  // "X est (le/la) président(e) de Y"
  const mPres = aff.match(/^(.+?)\s+est\s+(?:le\s+|la\s+)?pr[ée]sident(?:e)?\s+(?:de\s+(?:la\s+|le\s+|l\s+)?|du\s+)(.+)$/);
  if (mPres) return { type: 'president', sujet: mPres[1].trim(), objet: mPres[2].trim() };

  // "X cause/provoque Y"
  const mCause = aff.match(/^(.+?)\s+(?:cause(?:nt)?|provoqu(?:e(?:nt)?)?)\s+(.+)$/);
  if (mCause) return { type: 'causalite', sujet: mCause[1].trim(), objet: mCause[2].trim() };

  // "X est d'origine Y" / "X est d origine Y"
  const mOrigine = aff.match(/^(.+?)\s+est\s+(?:d\s+)?origine\s+(.+)$/);
  if (mOrigine) return { type: 'origine', sujet: mOrigine[1].trim(), objet: mOrigine[2].trim() };

  return null;
}

// ─────────────────────────────────────────────────────────
// MATCHING FUZZY PAR RADICAL
// Compare les 5 premiers caractères pour gérer les variantes
// ─────────────────────────────────────────────────────────

function motsMatchent(a, b) {
  if (a === b) return true;
  const len = Math.min(5, Math.min(a.length, b.length));
  if (len < 4) return false;
  return a.slice(0, len) === b.slice(0, len);
}

// ─────────────────────────────────────────────────────────
// ★ SCORING GÉNÉRIQUE AVEC FUZZY + DÉTECTION DE POLARITÉ
//
// [FIX] Ajout de la détection sémantique POUR/CONTRE
// via les listes CONFIRMATEURS / NUANCEURS.
// Avant ce fix, tout était 'neutre' → Agent 3 ignorait
// toutes les preuves → verdict INCERTAIN systématique.
// ─────────────────────────────────────────────────────────

function scoreGeneriqueAvecFuzzy(affirmation, extrait) {

  const motsAff     = tokeniserSignificatifs(affirmation);
  const motsExtrait = tokeniserSignificatifs(extrait);
  const extraitLower = extrait.toLowerCase();

  if (motsAff.length === 0) return { score: 0.35, polarity: 'neutre' };

  // Score de chevauchement lexical (fuzzy)
  let matches = 0;
  for (const ma of motsAff) {
    for (const me of motsExtrait) {
      if (motsMatchent(ma, me)) { matches++; break; }
    }
  }

  const ratio = matches / motsAff.length;
  // Score minimum 0.3 si l'article provient d'une recherche pertinente
  const score = Math.max(ratio, 0.30);

  // ★ FIX : Détection de polarité sémantique
  // Compte les mots confirmateurs et nuanceurs présents dans l'extrait
  const nbConfirm = CONFIRMATEURS.filter(c => extraitLower.includes(c)).length;
  const nbNuance  = NUANCEURS.filter(n => extraitLower.includes(n)).length;

  let polarity = 'neutre';
  if (nbConfirm > 0 && nbConfirm >= nbNuance) {
    polarity = 'pour';
  } else if (nbNuance > 0 && nbNuance > nbConfirm) {
    polarity = 'contre';
  }

  return { score, polarity };
}

// ─────────────────────────────────────────────────────────
// SCORING CONTEXTUEL STRUCTURÉ
// ─────────────────────────────────────────────────────────

function scoreContextuel(affirmation, extrait, structure) {

  const texte = normaliserTexte(extrait);

  if (structure?.type === 'capitale') {
    const { sujet, objet } = structure;
    const hasSujet    = texte.includes(sujet);
    const hasCapitale = texte.includes('capitale');
    const hasObjet    = texte.includes(objet);

    if (!hasSujet && !hasCapitale) return { score: 0.10, polarity: 'neutre' };
    if (hasSujet && hasCapitale && hasObjet)  return { score: 0.90, polarity: 'pour'   };
    if (hasSujet && hasCapitale && !hasObjet) return { score: 0.75, polarity: 'contre' };
    if (!hasSujet && hasCapitale && hasObjet) return { score: 0.65, polarity: 'contre' };
    return { score: 0.35, polarity: 'neutre' };
  }

  if (structure?.type === 'origine') {
    const { sujet, objet } = structure;
    const motsSujet = tokeniserSignificatifs(sujet);
    const motsObjet = tokeniserSignificatifs(objet);

    const matchSujet = motsSujet.length === 0 ? 1 :
      motsSujet.filter(ms =>
        tokeniserSignificatifs(texte).some(mt => motsMatchent(ms, mt))
      ).length / motsSujet.length;

    const matchObjet = motsObjet.length === 0 ? 1 :
      motsObjet.filter(mo =>
        tokeniserSignificatifs(texte).some(mt => motsMatchent(mo, mt))
      ).length / motsObjet.length;

    const score = (matchSujet + matchObjet) / 2;

    const motsPaysConnus = ['indien', 'indien', 'inde', 'nepal', 'asie', 'chine',
                            'egypte', 'egyptien', 'grec', 'arabe', 'persan'];
    const originesMentionnees = motsPaysConnus.filter(p => texte.includes(p));
    const contreditObjet = originesMentionnees.length > 0 &&
      !originesMentionnees.some(p => motsMatchent(p, objet));

    const polarity = score < 0.2 ? 'neutre' : contreditObjet ? 'contre' : 'pour';

    return { score: Math.max(score, 0.30), polarity };
  }

  if (structure?.type === 'causalite') {
    const { sujet, objet } = structure;
    const motsSujet = tokeniserSignificatifs(sujet);
    const motsObjet = tokeniserSignificatifs(objet);
    const texteTokens = tokeniserSignificatifs(texte);

    const mS = motsSujet.length === 0 ? 1 :
      motsSujet.filter(ms => texteTokens.some(mt => motsMatchent(ms, mt))).length / motsSujet.length;
    const mO = motsObjet.length === 0 ? 1 :
      motsObjet.filter(mo => texteTokens.some(mt => motsMatchent(mo, mt))).length / motsObjet.length;

    const score = (mS + mO) / 2;
    const negation = ['ne cause pas','ne provoque pas','aucun lien','pas de lien'].some(n => texte.includes(n));

    return { score: Math.max(score, 0.30), polarity: negation ? 'contre' : score > 0.4 ? 'pour' : 'neutre' };
  }

  // ── Fallback générique avec fuzzy matching + polarité sémantique ──
  return scoreGeneriqueAvecFuzzy(affirmation, extrait);
}

// ─────────────────────────────────────────────────────────
// SCORING PRINCIPAL
// ─────────────────────────────────────────────────────────

async function scorerPertinence(affirmation, criteres, preuves) {

  if (preuves.length === 0) return [];

  const structure = extraireStructureClaim(affirmation);
  console.log('\n[Agent 2] Structure détectée :', structure ? structure.type : 'générique');

  const aScorer    = preuves.filter(p => p.type !== 'qdrant');
  const dejaScores = preuves.filter(p => p.type === 'qdrant');

  let resultatsScores = [...dejaScores];

  if (aScorer.length > 0) {

    try {
      // ── Tentative Gemini ──────────────────────────────
      const prompt = `
Tu es un expert en fact-checking.

Affirmation : "${affirmation}"
Critères : "${criteres}"

Pour chaque extrait, donne un score (0.0-1.0) et une polarité ("pour","contre","neutre").

${aScorer.slice(0, 12).map((p, i) =>
  `[${i}] ${p.source}: ${p.extrait.slice(0, 250)}`
).join('\n\n')}

JSON uniquement :
{ "resultats": [{"score": 0.8, "polarity": "contre"}, ...] }
`;

      const response = await axios.post(GEMINI_URL, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.0, maxOutputTokens: 500 },
      });

      let texte = response.data.candidates[0].content.parts[0].text;
      texte = texte.replace(/```json/g, '').replace(/```/g, '').trim();
      const { resultats } = JSON.parse(texte);

      aScorer.forEach((preuve, i) => {
        const r = resultats[i] || {};
        resultatsScores.push({
          ...preuve,
          score_pertinence: Number(r.score ?? 0),
          polarity: r.polarity || 'neutre',
        });
      });

      console.log('[Agent 2] Scoring Gemini : OK');

    } catch (e) {

      // ── Fallback contextuel + fuzzy ───────────────────
      console.warn('[Agent 2] Scoring Gemini ÉCHEC :', e.message);
      console.warn('[Agent 2] → Fallback scoring contextuel + fuzzy + polarité sémantique');

      aScorer.forEach(preuve => {
        const { score, polarity } = scoreContextuel(affirmation, preuve.extrait, structure);
        resultatsScores.push({
          ...preuve,
          score_pertinence: score,
          polarity,
          scoring_fallback: true,
        });
      });
    }
  }

  // ─── Filtrage ──────────────────────────────────────────
  const avant   = resultatsScores.length;
  const filtres = resultatsScores.filter(p => p.score_pertinence >= SEUIL_PERTINENCE);

  console.log(
    `\n[Agent 2] Pertinence : ${avant} preuves → ${filtres.length} retenues (seuil ${SEUIL_PERTINENCE})`
  );
  filtres.forEach(p =>
    console.log(
      `  [${p.score_pertinence.toFixed(2)} | ${(p.polarity || '?').padEnd(6)}${p.scoring_fallback ? ' fallback' : ''}]`,
      p.source.slice(0, 30).padEnd(30), '—', p.extrait.slice(0, 70) + '…'
    )
  );

  return filtres.sort((a, b) => b.score_pertinence - a.score_pertinence);
}

// ─────────────────────────────────────────────────────────
// FONCTION PRINCIPALE
// ─────────────────────────────────────────────────────────

async function chercher(analyseAgent1) {

  const affirmation   = analyseAgent1.affirmation_originale;
  const sousQuestions = analyseAgent1.sous_questions || [];
  const motsCles      = analyseAgent1.mots_cles      || [];
  const criteres      = analyseAgent1.criteres_pertinence ||
    `Une preuve pertinente doit traiter directement de : ${affirmation}`;

  console.log('\n═══════════════════════════════');
  console.log('Affirmation :', affirmation);
  console.log('Critères    :', criteres);
  console.log('Mots-clés   :', motsCles);

  // ★ FIX CRITIQUE : en mode fallback (Agent 1 en erreur),
  // on ne lance QUE l'affirmation complète comme requête.
  // Les mots isolés ('principal', 'effet', 'serre') génèrent
  // des résultats parasites (serres de jardin, dictionnaires,
  // Principal Financial Group...) qui noient les vraies preuves.
  let requetes;
  if (analyseAgent1.erreur) {
    requetes = [affirmation];
    console.log('\n[Agent 2] Mode fallback : requête unique (affirmation complète)');
  } else {
    requetes = [...new Set([affirmation, ...sousQuestions, ...motsCles])]
      .filter(r => r && normaliserTexte(r).length > 3)
      .slice(0, 5);
  }

  console.log('\nREQUÊTES:', requetes);

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

  console.log('\nQdrant  :', preuvesQdrant.length);
  console.log('NewsAPI :', preuvesNews.length);
  console.log('SerpAPI :', preuvesSerp.length);

  let toutesPreuves = supprimerDoublons([
    ...preuvesNews, ...preuvesSerp, ...preuvesQdrant,
  ]);

  toutesPreuves = await scorerPertinence(affirmation, criteres, toutesPreuves);

  console.log('\n===== PREUVES PERTINENTES FINALES =====');
  console.log(JSON.stringify(toutesPreuves, null, 2));

  return {
    affirmation,
    criteres_pertinence: criteres,
    structure_claim:     extraireStructureClaim(affirmation),
    resultats:           toutesPreuves,
    sources_citees:      [...new Set(toutesPreuves.map(p => p.url).filter(Boolean))],
    alerte_sources_insuffisantes: toutesPreuves.length === 0,
  };
}

export default { chercher };