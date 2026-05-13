// ══════════════════════════════════════════════════════════
// AGENT 2 — CHERCHEUR
// Recherche multi-sources :
// - Qdrant
// - NewsAPI
// - SerpAPI
// ══════════════════════════════════════════════════════════

import axios from 'axios';

// ─────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────

const GEMINI_EMBED_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GEMINI_API_KEY}`;

const QDRANT_URL =
  process.env.QDRANT_URL ||
  'http://localhost:6333';

const COLLECTION =
  process.env.QDRANT_COLLECTION ||
  'fake_news_detector';

const SCORE_THRESHOLD = 0.50;
const TOP_K = 5;

// ─────────────────────────────────────────────────────────
// EMBEDDING
// ─────────────────────────────────────────────────────────

async function embedTexte(
  texte,
  taskType = 'retrieval_query'
) {

  try {

    const response =
      await axios.post(
        GEMINI_EMBED_URL,
        {
          model: 'models/embedding-001',

          content: {
            parts: [
              {
                text: texte
              }
            ]
          },

          taskType,
        }
      );

    return response.data.embedding.values;

  } catch (error) {

    console.error(
      '\n[EMBED ERROR]',
      error.response?.data ||
      error.message
    );

    return null;
  }
}

// ─────────────────────────────────────────────────────────
// QDRANT
// ─────────────────────────────────────────────────────────

async function rechercherQdrant(question) {

  try {

    console.log('\n===== QDRANT SEARCH =====');

    const vecteur =
      await embedTexte(question);

    if (!vecteur) {

      console.warn(
        '[QDRANT] Embedding indisponible'
      );

      return [];
    }

    const response =
      await axios.post(
        `${QDRANT_URL}/collections/${COLLECTION}/points/search`,
        {
          vector: vecteur,
          limit: TOP_K,
          score_threshold: SCORE_THRESHOLD,
          with_payload: true,
        }
      );

    console.log(
      'Résultats Qdrant :',
      response.data.result?.length || 0
    );

    return (
      response.data.result || []
    ).map(r => ({

      source:
        r.payload?.source ||
        'Qdrant',

      extrait:
        r.payload?.texte ||
        r.payload?.content ||
        r.payload?.affirmation ||
        '',

      score_pertinence:
        Number(r.score || 0),

      url:
        r.payload?.url || '',

      type: 'qdrant',
    }));

  } catch (error) {

    console.warn(
      '\n[Agent 2] Qdrant ERROR:',
      error.response?.data ||
      error.message
    );

    return [];
  }
}

// ─────────────────────────────────────────────────────────
// NEWS API
// ─────────────────────────────────────────────────────────

async function rechercherNewsAPI(question) {

  try {

    console.log('\n===== NEWS API SEARCH =====');
    console.log('Question:', question);

    const response =
      await axios.get(
        'https://newsapi.org/v2/everything',
        {
          params: {

            q: question,

            apiKey:
              process.env.NEWSAPI_KEY,

            language: 'fr',

            sortBy: 'relevancy',

            pageSize: 5,
          },

          timeout: 10000,
        }
      );

    console.log(
      'Nombre articles:',
      response.data.articles?.length || 0
    );

    return (
      response.data.articles || []
    ).map(article => ({

      source:
        article.source?.name ||
        'NewsAPI',

      extrait:
        article.description ||
        article.title ||
        article.content ||
        '',

      score_pertinence: 0.80,

      url:
        article.url || '',

      type: 'newsapi',
    }));

  } catch (error) {

    console.warn(
      '\n[Agent 2] NewsAPI ERROR:',
      error.response?.data ||
      error.message
    );

    return [];
  }
}

// ─────────────────────────────────────────────────────────
// SERP API
// ─────────────────────────────────────────────────────────

async function rechercherSerpAPI(question) {

  try {

    console.log('\n===== SERP API SEARCH =====');
    console.log('Question:', question);

    const response =
      await axios.get(
        'https://serpapi.com/search.json',
        {
          params: {

            q: question,

            api_key:
              process.env.SERPAPI_KEY,

            hl: 'fr',

            num: 5,
          },

          timeout: 10000,
        }
      );

    const resultats =
      response.data.organic_results || [];

    console.log(
      'Nombre résultats:',
      resultats.length
    );

    return resultats.map(r => ({

      source:
        r.source ||
        'Google',

      extrait:
        r.snippet ||
        r.title ||
        '',

      score_pertinence: 0.70,

      url:
        r.link || '',

      type: 'serpapi',
    }));

  } catch (error) {

    console.warn(
      '\n[Agent 2] SerpAPI ERROR:',
      error.response?.data ||
      error.message
    );

    return [];
  }
}

// ─────────────────────────────────────────────────────────
// SUPPRESSION DOUBLONS
// ─────────────────────────────────────────────────────────

function supprimerDoublons(preuves) {

  const dejaVu = new Set();

  return preuves.filter(p => {

    const cle =
      `${p.source}-${p.extrait}`;

    if (dejaVu.has(cle)) {
      return false;
    }

    dejaVu.add(cle);

    return true;
  });
}

// ─────────────────────────────────────────────────────────
// FONCTION PRINCIPALE
// ─────────────────────────────────────────────────────────

async function chercher(analyseAgent1) {

  const affirmation =
    analyseAgent1.affirmation_originale;

  const sousQuestions =
    analyseAgent1.sous_questions || [];

  const motsCles =
    analyseAgent1.mots_cles || [];

  console.log(
    '\n═══════════════════════════════'
  );

  console.log(
    'Affirmation reçue :',
    affirmation
  );

  console.log(
    'Sous-questions :',
    sousQuestions
  );

  // ─────────────────────────────────
  // Construire requêtes de recherche
  // ─────────────────────────────────

  const requetes = [

    affirmation,

    ...sousQuestions,

    ...motsCles,
  ]
  .filter(Boolean)
  .slice(0, 5);

  console.log(
    '\nREQUÊTES:',
    requetes
  );

  // ─────────────────────────────────
  // Recherche multi-sources
  // ─────────────────────────────────

  let preuvesQdrant = [];
  let preuvesNews = [];
  let preuvesSerp = [];

  for (const req of requetes) {

    const [
      qdrant,
      news,
      serp,
    ] = await Promise.all([

      rechercherQdrant(req),

      rechercherNewsAPI(req),

      rechercherSerpAPI(req),
    ]);

    preuvesQdrant.push(...qdrant);
    preuvesNews.push(...news);
    preuvesSerp.push(...serp);
  }

  console.log(
    '\nQdrant:',
    preuvesQdrant.length
  );

  console.log(
    'NewsAPI:',
    preuvesNews.length
  );

  console.log(
    'SerpAPI:',
    preuvesSerp.length
  );

  // ─────────────────────────────────
  // Fusion preuves
  // ─────────────────────────────────

  let toutesPreuves = [

    ...preuvesNews,

    ...preuvesSerp,

    ...preuvesQdrant,
  ];

  toutesPreuves =
    supprimerDoublons(
      toutesPreuves
    );

  console.log(
    '\n===== PREUVES FINALES ====='
  );

  console.log(
    JSON.stringify(
      toutesPreuves,
      null,
      2
    )
  );

  // ─────────────────────────────────
  // Extraction données utiles
  // ─────────────────────────────────

  const sources_citees =
    [...new Set(
      toutesPreuves
        .map(p => p.url)
        .filter(Boolean)
    )];

  // ─────────────────────────────────
  // Retour Agent 3
  // ─────────────────────────────────

  return {

    affirmation,

    resultats:
      toutesPreuves,

    sources_citees,

    alerte_sources_insuffisantes:
      toutesPreuves.length === 0,
  };
}

export default { chercher };