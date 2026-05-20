// ══════════════════════════════════════════════════════════
// INGESTION QDRANT — VERSION FINALE
// Compatible avec Agent2 (HF all-MiniLM-L6-v2)
// Dimension = 384
// ══════════════════════════════════════════════════════════

import dotenv from "dotenv";

dotenv.config({
  path: "../.env",
});

import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { pipeline } from '@xenova/transformers';

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

const QDRANT_URL =
  process.env.QDRANT_URL ||
  "http://localhost:6333";

const COLLECTION =
  process.env.QDRANT_COLLECTION ||
  "fake_news_detector";

// ─────────────────────────────────────────────
// DEBUG
// ─────────────────────────────────────────────

console.log("===== ENV =====");

console.log(
  "HF_TOKEN:",
  !!process.env.HF_TOKEN
);

console.log(
  "QDRANT_URL:",
  QDRANT_URL
);

// ─────────────────────────────────────────────
// DOCUMENTS
// ─────────────────────────────────────────────

const DOCUMENTS = [

  {
    texte:
      "Les vaccins ne causent pas l'autisme selon l'OMS.",

    source: "OMS",

    categorie: "sante",

    url: "https://www.who.int",

    date: "2025-01-01",
  },

  {
    texte:
      "Le CO2 est un gaz à effet de serre important responsable du réchauffement climatique.",

    source: "GIEC",

    categorie: "climat",

    url: "https://www.ipcc.ch",

    date: "2025-01-01",
  },

  {
    texte:
      "La Terre est sphérique selon les observations scientifiques.",

    source: "NASA",

    categorie: "science",

    url: "https://www.nasa.gov",

    date: "2025-01-01",
  },

];

// ─────────────────────────────────────────────
// EMBEDDING HF
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// CRÉATION COLLECTION
// ─────────────────────────────────────────────

async function creerCollection() {

  try {

    await axios.delete(
      `${QDRANT_URL}/collections/${COLLECTION}`
    );

    console.log(
      "🗑️ Ancienne collection supprimée"
    );

  } catch {}

  await axios.put(

    `${QDRANT_URL}/collections/${COLLECTION}`,

    {
      vectors: {
        size: 384,
        distance: "Cosine",
      },
    }
  );

  console.log(
    "✅ Collection créée"
  );
}

// ─────────────────────────────────────────────
// INGESTION
// ─────────────────────────────────────────────

async function ingerer() {

  await creerCollection();

  const points = [];

  for (const doc of DOCUMENTS) {

    console.log(
      `📥 ${doc.source}`
    );

    const vecteur =
      await embedTexte(doc.texte);

    if (!vecteur) {

      console.log(
        "❌ Embedding impossible"
      );

      continue;
    }

    console.log(
      "📏 Dimension:",
      vecteur.length
    );

    points.push({

      id: uuidv4(),

      vector: vecteur,

      payload: {

        texte:
          doc.texte,

        source:
          doc.source,

        categorie:
          doc.categorie,

        url:
          doc.url,

        date:
          doc.date,
      },
    });
  }

  // IMPORTANT
  if (points.length === 0) {

    throw new Error(
      "Aucun embedding généré"
    );
  }

  const response = await axios.put(

    `${QDRANT_URL}/collections/${COLLECTION}/points?wait=true`,

    {
      points,
    }
  );

  console.log(
    "✅ Insertion Qdrant OK"
  );

  console.log(
    response.data
  );

  const info = await axios.get(
    `${QDRANT_URL}/collections/${COLLECTION}`
  );

  console.log(
    "📊 POINTS:",
    info.data.result.points_count
  );

  console.log(
    "\n🏁 INGESTION TERMINÉE"
  );
}

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────

ingerer().catch((err) => {

  console.error(
    "❌ ERREUR:",
    err.response?.data ||
    err.message
  );
});