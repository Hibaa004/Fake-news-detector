import dotenv from "dotenv";
dotenv.config();

import axios from "axios";

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
// SETUP
// ─────────────────────────────────────────────

async function setup() {

  try {

    console.log(
      "\n🚀 Création collection Qdrant..."
    );

    // supprimer ancienne collection

    try {

      await axios.delete(
        `${QDRANT_URL}/collections/${COLLECTION}`
      );

      console.log(
        "🗑️ Ancienne collection supprimée"
      );

    } catch {}

    // création collection

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
      "✅ Collection créée avec succès !"
    );

    // vérifier

    const res =
      await axios.get(
        `${QDRANT_URL}/collections/${COLLECTION}`
      );

    console.log(
      "\n📊 Collection info :"
    );

    console.log(
      JSON.stringify(
        res.data.result,
        null,
        2
      )
    );

  } catch (err) {

    console.error(
      "\n❌ ERREUR QDRANT :",
      err.response?.data ||
      err.message
    );
  }
}



setup();