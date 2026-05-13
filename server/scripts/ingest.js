// ══════════════════════════════════════════════════════════
// SETUP QDRANT + INGESTION
// ══════════════════════════════════════════════════════════
import dotenv from "dotenv";

dotenv.config({
  path: "../.env",
});

import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { GoogleGenAI } from "@google/genai";

// ─────────────────────────────────────────────
// DEBUG ENV
// ─────────────────────────────────────────────



console.log("===== ENV =====");

console.log(
  "GEMINI_API_KEY:",
  !!process.env.GEMINI_API_KEY
);

console.log(
  "QDRANT_URL:",
  process.env.QDRANT_URL
);

// ─────────────────────────────────────────────
// Gemini
// ─────────────────────────────────────────────

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// ─────────────────────────────────────────────
// Qdrant
// ─────────────────────────────────────────────

const QDRANT_URL =
  process.env.QDRANT_URL ||
  "http://localhost:6333";

const COLLECTION =
  process.env.QDRANT_COLLECTION ||
  "fake_news_detector";

// ─────────────────────────────────────────────
// Documents
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
// Embedding
// ─────────────────────────────────────────────

async function embedTexte(text) {

  const response =
    await ai.models.embedContent({

      model:
        "gemini-embedding-001",

      contents: text,
    });

  return response
    .embeddings[0]
    .values;
}

// ─────────────────────────────────────────────
// Création collection
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
        size: 3072,
        distance: "Cosine",
      },
    }
  );

  console.log(
    "✅ Collection créée"
  );
}

// ─────────────────────────────────────────────
// Ingestion
// ─────────────────────────────────────────────

async function ingerer() {

  await creerCollection();

  const points = [];

  for (const doc of DOCUMENTS) {

    console.log(
      `📥 ${doc.source}`
    );

    const vecteur =
      await embedTexte(
        doc.texte
      );

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

  const response =
    await axios.put(
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

  const info =
    await axios.get(
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