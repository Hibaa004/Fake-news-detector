import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { pipeline } from '@xenova/transformers';


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
// Normalisation:minuscules->enlèvent ponctuation+espaces superflus
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
function scoreGeneriqueLocal(
  affirmation,
  extrait,
  negationAttendue,
  structure
) {

  const motsAff     = tokeniserSignificatifs(affirmation);
  const motsExtrait = tokeniserSignificatifs(extrait);

  const extraitLow  = normaliserTexte(extrait);

  // =====================================================
  // SCORE LEXICAL
  // =====================================================

  let matches = 0;

  for (const ma of motsAff) {
    for (const me of motsExtrait) {
      if (motsMatchent(ma, me)) {
        matches++;
        break;
      }
    }
  }

  const score =
    motsAff.length > 0
      ? Math.max(matches / motsAff.length, 0.25)
      : 0.25;

  // =====================================================
  // STRUCTURE CLAIM
  // =====================================================

  const sujet =
    normaliserTexte(structure?.sujet || '');

  const predicat =
    normaliserTexte(
      structure?.predicat ||
      structure?.role_revendique ||
      ''
    );

  const sujetPresent =
    sujet &&
    extraitLow.includes(sujet);

  const predicatTokens =
    tokeniserSignificatifs(predicat);

  const predicatPresent =
    predicatTokens.length > 0 &&
    predicatTokens.some(t =>
      extraitLow.includes(t)
    );

  // =====================================================
  // CAS NORMAL :
  // sujet + prédicat présents = POUR
  // =====================================================

  if (sujetPresent && predicatPresent) {

    return {
      score: Math.max(score, 0.85),
      polarity: 'pour'
    };
  }

  // =====================================================
  // CONTRADICTION DYNAMIQUE
  // =====================================================

  if (
    structure?.sujet &&
    structure?.predicat &&
    detecterContradictionDynamique(
      structure.sujet,
      structure.predicat,
      extrait
    )
  ) {

    return {
      score: Math.max(score, 0.85),
      polarity: 'contre'
    };
  }

  // =====================================================
  // NEGATION ATTENDUE
  // IMPORTANT :
  // seulement si expression forte de contradiction
  // =====================================================

  if (negationAttendue) {

    const patternsContradiction = [
      'n est pas',
      'ne sont pas',
      'contrairement',
      'faux',
      'incorrect',
      'inexact',
      'mais pas',
      'et non',
      'plutot que',
      'au lieu de'
    ];

    const contradictionExplicite =
      patternsContradiction.some(p =>
        extraitLow.includes(p)
      );

    if (contradictionExplicite) {

      return {
        score: Math.max(score, 0.75),
        polarity: 'contre'
      };
    }
  }

  // =====================================================
  // INDICATEURS GENERIQUES
  // =====================================================

  const nbPour =
    INDICATEURS_POUR.filter(c =>
      extraitLow.includes(c)
    ).length;

  const nbContre =
    INDICATEURS_CONTRE.filter(c =>
      extraitLow.includes(c)
    ).length;

  if (nbPour > nbContre && nbPour > 0) {

    return {
      score,
      polarity: 'pour'
    };
  }

  if (nbContre > nbPour && nbContre > 0) {

    return {
      score,
      polarity: 'contre'
    };
  }

  // =====================================================
  // PAR DEFAUT :
  // si sujet présent → plutôt POUR
  // =====================================================

  if (sujetPresent) {

    return {
      score,
      polarity: 'pour'
    };
  }

  return {
    score,
    polarity: 'neutre'
  };
}

// ─────────────────────────────────────────────────────────
// Embedding
// ─────────────────────────────────────────────────────────
let extractor = null;

async function getExtractor() {

  if (!extractor) {

    console.log(
      '📦 Chargement modèle HF local...'
    );

    extractor = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    );

    console.log(
      '✅ Modèle chargé'
    );
  }

  return extractor;
}

async function embedTexte(texte) {

  try {

    const model =
      await getExtractor();

    const output =
      await model(texte, {
        pooling: 'mean',
        normalize: true,
      });

    return Array.from(output.data);

  } catch (error) {

    console.error(
      '[LOCAL HF ERROR]',
      error.message
    );

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
const RAG_DIR = path.join(process.cwd(), 'rag_documents');

if (!fs.existsSync(RAG_DIR)) {
  fs.mkdirSync(RAG_DIR, { recursive: true });
}


// ─────────────────────────────────────────────────────────
// SAUVEGARDE URLS SOURCES
// ─────────────────────────────────────────────────────────

function sauvegarderSourcesDansRAG(affirmation, preuves) {

  try {

    // nom fichier propre
    const nomFichier =
      normaliserTexte(affirmation)
        .replace(/\s+/g, '_')
        .slice(0, 60);

    const cheminFichier =
      path.join(
        RAG_DIR,
        `${nomFichier}.txt`
      );

    // URLs uniques
    const urls = [
      ...new Set(
        preuves
          .map(p => p.url)
          .filter(Boolean)
      )
    ];

    // contenu
    const contenu =
`AFFIRMATION :
${affirmation}

DATE :
${new Date().toLocaleString('fr-FR')}

========================================
SOURCES UTILISÉES
========================================

${urls.join('\n')}
`;

    fs.writeFileSync(
      cheminFichier,
      contenu,
      'utf-8'
    );

    console.log(
      `📁 Sources sauvegardées dans : ${cheminFichier}`
    );

  } catch (err) {

    console.error(
      '[RAG SAVE ERROR]',
      err.message
    );
  }
}
// ─────────────────────────────────────────────────────────
// Suppression doublons:Évite de scorer plusieurs fois le même extrait identique provenant de sources différentes
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
// Scoring principal 
// ─────────────────────────────────────────────────────────
async function scorerPertinence(
  affirmation,
  criteres,
  preuves,
  analyseAgent1
) {

  if (preuves.length === 0) return [];

  const negationAttendue =
    analyseAgent1?.negation_attendue || '';

  const structure =
    analyseAgent1?.structure || {};

  const resultatsScores = [];

  for (const preuve of preuves) {

    const { score, polarity } =
      scoreGeneriqueLocal(
        affirmation,
        preuve.extrait,
        negationAttendue,
        structure
      );

    resultatsScores.push({
      ...preuve,
      score_pertinence: score,
      polarity,
      scoring_fallback: true,
    });
  }

  const filtres =
    resultatsScores.filter(
      p => p.score_pertinence >= SEUIL_PERTINENCE
    );

  console.log(
    `\n[Agent2] ${resultatsScores.length} preuves → ${filtres.length} retenues`
  );

  return filtres.sort(
    (a, b) =>
      b.score_pertinence - a.score_pertinence
  );
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

sauvegarderSourcesDansRAG(
  affirmation,
  toutesPreuves
);

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