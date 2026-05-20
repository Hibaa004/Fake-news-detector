# 🔍 Fake News Detector

Système multi-agents de vérification d'informations basé sur l’IA et le RAG (Retrieval-Augmented Generation).  
Le workflow enchaîne :

1. Analyse de l'affirmation
2. Recherche de preuves multi-sources
3. Jugement final et recommandation

Réalisé par : **Hiba KAAOUACH** & **Oumaima BOUMAZOUED**  
Encadré par : **Dr. Hasnaa CHAABI** — EMSI 2025-2026

---

## ✅ Fonctionnalités

- Pipeline multi-agents :
  - Agent 1 → Analyseur
  - Agent 2 → Chercheur
  - Agent 3 → Juge
- Agent 1 & Agent 3 basés sur **Groq Llama 3.3**
- Agent 2 basé sur :
  - **HuggingFace Embeddings**
  - **Qdrant Vector Database**
  - **NewsAPI**
  - **SerpAPI**
- Recherche RAG avec embeddings locaux (`Xenova/all-MiniLM-L6-v2`)
- Stockage vectoriel avec Qdrant
- Sauvegarde automatique des URLs collectées dans `rag_documents/`
- Verdict avec :
  - score de fiabilité
  - arguments POUR / CONTRE
  - biais détectés
  - sources citées
- Envoi de rapport par email (optionnel)
- Interface React avec suivi temps réel des agents

---

## 📁 Structure du projet

```txt
fake-news-detector/
├── server/                              ← Backend Node.js
│   ├── index.js                         ← Serveur Express + pipeline principal
│   ├── .env                             ← Clés API (à remplir)
│   ├── package.json
│   │
│   ├── agents/
│   │   ├── agent1_analyseur.js          ← Agent 1 : analyse de l'affirmation
│   │   ├── agent2_chercheur.js          ← Agent 2 : recherche RAG + APIs
│   │   └── agent3_juge.js               ← Agent 3 : verdict final
│   │
│   ├── rag_documents/                   ← Sources collectées automatiquement
│   │   ├── sources_2026-05-20.txt
│   │   └── ...
│   │
│   ├── scripts/
│   │   ├── setup_qdrant.js              ← Création collection Qdrant
│   │   └── ingest.js                    ← Ingestion des documents RAG
│   │
│   └── services/
│       ├── mailer.js                    ← Envoi d'emails
│       └── sheets.js                    ← Journalisation Google Sheets
│
└── client/                              ← Frontend React
    ├── package.json
    ├── public/
    │   └── index.html
    │
    └── src/
        ├── App.js
        ├── App.css
        ├── index.js
        │
        └── components/
            ├── Header.js
            ├── VerifyForm.js
            ├── StepTracker.js
            └── ResultCard.js
```

---

## ⚙️ Configuration des clés API

Ouvre `server/.env` et ajoute :

```env
# ─────────────── GROQ ───────────────
GROQ_API_KEY=...

# ─────────────── NEWS API ───────────────
NEWSAPI_KEY=...

# ─────────────── SERP API ───────────────
SERPAPI_KEY=...

# ─────────────── EMAIL ───────────────
GMAIL_USER=...
GMAIL_APP_PASSWORD=...

# ─────────────── QDRANT ───────────────
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=fake_news_detector

# ─────────────── SERVER ───────────────
PORT=3001
```

Notes :

- `GMAIL_USER` et `GMAIL_APP_PASSWORD` sont nécessaires seulement pour recevoir le rapport par email.
- Les embeddings HuggingFace sont exécutés localement avec Transformers.js.
- Qdrant est utilisé comme base vectorielle pour le RAG.

---

## 🐳 Lancer Qdrant

```bash
docker run -d -p 6333:6333 -v qdrant_storage:/qdrant/storage qdrant/qdrant
```

Dashboard :

```txt
http://localhost:6333/dashboard
```

---

## 🧠 Créer la collection Qdrant

```bash
cd server/scripts
node setup_qdrant.js
```

---

## 📥 Ingestion des documents RAG

```bash
cd server/scripts
node ingest.js
```

Cela permet :

- de transformer les documents en embeddings
- de stocker les vecteurs dans Qdrant
- d’alimenter le système RAG

---

## 🖥️ Lancer le serveur

```bash
cd server
npm install
npm run dev
```

Le serveur tourne sur :

```txt
http://localhost:3001
```

---

## ⚛️ Lancer l'interface React

```bash
cd client
npm install
npm start
```

L'interface s'ouvre sur :

```txt
http://localhost:3000
```

---

## 🧪 Tester l'API

### Requête POST `/verify`

```bash
curl -X POST http://localhost:3001/verify \
  -H "Content-Type: application/json" \
  -d '{"affirmation":"La Terre est plate","email":"test@gmail.com"}'
```

Réponse (exemple) :

```json
{
  "affirmation": "La Terre est plate",
  "verdict": "FAUX",
  "score_fiabilite": 90,
  "arguments_pour": [],
  "arguments_contre": ["..."],
  "biais_detectes": ["biais de confirmation"],
  "sources_citees": ["https://www.nasa.gov"],
  "recommandation": "Consulter des sources scientifiques fiables."
}
```

---

## 📊 Logs utiles

Le serveur affiche les étapes du pipeline :

```txt
[PIPELINE] Agent 1 OK
[PIPELINE] Agent 2 OK
[PIPELINE] Agent 3 OK
```

Exemple :

```txt
[QDRANT] 3 résultat(s)
[NewsAPI] 5 article(s)
[SerpAPI] 8 résultat(s)
```

---

## 📚 Dossier RAG

Le dossier :

```txt
server/rag_documents/
```

contient automatiquement les URLs des sources collectées par l’Agent 2 pendant les analyses.

Exemple :

```txt
sources_2026-05-20.txt
```

Contenu :

```txt
https://www.who.int
https://www.nasa.gov
https://fr.wikipedia.org/wiki/Terre
...
```

---

## ❗ Problèmes fréquents

| Problème                         | Solution                                                |
| -------------------------------- | ------------------------------------------------------- |
| `CORS error`                     | Vérifier que React appelle bien `http://localhost:3001` |
| `Groq API error`                 | Vérifier `GROQ_API_KEY`                                 |
| `Qdrant connection refused`      | Lancer Docker Qdrant                                    |
| `Embedding model loading failed` | Vérifier l’installation de `@xenova/transformers`       |
| `Email not sent`                 | Utiliser un App Password Gmail                          |
| `JSON parse error`               | Les agents réessaient automatiquement                   |
| `Qdrant empty collection`        | Exécuter `node ingest.js`                               |
